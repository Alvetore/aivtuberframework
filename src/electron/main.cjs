const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) { if (existing.isMinimized()) existing.restore(); existing.focus(); }
});
const secrets = require('./secrets.cjs');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const sessionToken = randomBytes(32).toString('hex');
const secretKeys = new Set(['twitchOauthToken', 'llmApiKey', 'openaiTtsApiKey', 'elevenlabsApiKey']);
let serverUrl = '';
let quitting = false;
let restarting = false;
const watchers = [];
let reloadTimer;

let serverProcess = null;

async function startServer() {
  let serverScript = path.join(__dirname, '..', '..', 'dist', 'server', 'index.js');
  let rendererRoot = path.join(__dirname, '..', '..', 'dist', 'renderer');
  const development = isDevMode();
  if (development) serverScript = path.join(__dirname, '..', 'server', 'index.ts');
  if (!fs.existsSync(serverScript)) throw new Error('Backend not found. Run npm run build.');
  if (!app.isPackaged) {
    try { process.loadEnvFile?.(path.join(__dirname, '..', '..', '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const values = secrets.initialize({
    twitchOauthToken: process.env.TWITCH_OAUTH_TOKEN, llmApiKey: process.env.LLM_API_KEY,
    openaiTtsApiKey: process.env.OPENAI_TTS_API_KEY, elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
  });
  const env = {
    ...process.env, TWITCH_OAUTH_TOKEN: values.twitchOauthToken, LLM_API_KEY: values.llmApiKey,
    OPENAI_TTS_API_KEY: values.openaiTtsApiKey, ELEVENLABS_API_KEY: values.elevenlabsApiKey,
    ELECTRON_USER_DATA: development ? path.join(__dirname, '..', '..', 'data') : app.getPath('userData'), APP_SESSION_TOKEN: sessionToken,
    PORT: development ? '3001' : '0', RENDERER_ROOT: development ? '' : rendererRoot,
    VITE_DEV_ORIGIN: development ? new URL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173').origin : '',
    SILERO_SCRIPT_PATH: app.isPackaged ? path.join(process.resourcesPath, 'scripts', 'silero_server.py') : path.join(__dirname, '..', '..', 'scripts', 'silero_server.py'),
  };
  if (app.isPackaged) env.ELECTRON_RUN_AS_NODE = '1';
  const args = development ? ['--import', pathToFileURL(require.resolve('tsx')).href, serverScript] : [serverScript];
  const child = spawn(app.isPackaged ? process.execPath : 'node', args, { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
  serverProcess = child;
  let ready = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend startup timed out.')), 20_000);
    const failed = error => { clearTimeout(timer); reject(error); };
    child.once('error', failed);
    child.once('exit', code => {
      if (serverProcess === child) serverProcess = null;
      failed(new Error(`Backend exited (${code}).`));
      if (ready && !quitting && !restarting) { dialog.showErrorBox('AI VTuber', 'Backend stopped. Restart the application.'); app.quit(); }
    });
    child.on('message', message => {
      if (message?.type === 'secrets:write') {
        try {
          if (!message.changes || typeof message.changes !== 'object' || Array.isArray(message.changes) || !Object.keys(message.changes).every(key => secretKeys.has(key))) throw new Error('Invalid secret request.');
          const updated = secrets.update(message.changes, message.onlyMissing === true);
          child.send({ type: 'secrets:result', requestId: message.requestId, values: updated });
        } catch (error) { child.send({ type: 'secrets:result', requestId: message.requestId, error: error.message }); }
      } else if (message?.type === 'server:ready' && Number.isInteger(message.port) && message.port > 0 && message.port <= 65535) {
        ready = true; clearTimeout(timer); serverUrl = `http://127.0.0.1:${message.port}`; resolve();
      }
    });
  });
  await session.defaultSession.cookies.set({ url: serverUrl, name: 'vtuber_session', value: sessionToken, httpOnly: true, sameSite: 'strict', path: '/' });
}

async function stopServer() {
  const child = serverProcess;
  if (!child) return;
  if (!child.pid || child.exitCode !== null) { serverProcess = null; return; }
  await new Promise(resolve => {
    const timeout = setTimeout(() => { child.kill(); resolve(); }, 5000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    if (child.connected) child.send({ type: 'shutdown' }); else child.kill();
  });
  if (serverProcess === child) serverProcess = null;
}

const distHtml = path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html');

function isDevMode() {
  if (app.isPackaged) return false;
  if (process.argv.includes('--dev') || process.env.NODE_ENV === 'development') return true;
  return !fs.existsSync(distHtml);
}

function watchBackend() {
  if (!isDevMode()) return;
  let pending = Promise.resolve();
  for (const directory of ['server', 'shared']) {
    watchers.push(fs.watch(path.join(__dirname, '..', directory), { recursive: true }, (_event, filename) => {
      if (filename && (!filename.endsWith('.ts') || filename.includes('__tests__'))) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        pending = pending.then(async () => {
          if (quitting) return;
          restarting = true;
          try { await stopServer(); if (!quitting) await startServer(); }
          catch (error) { dialog.showErrorBox('AI VTuber — reload failed', error.message); app.quit(); }
          finally { restarting = false; }
        });
      }, 200);
    }));
  }
}

function protectWindow(window) {
  window.webContents.on('will-prevent-unload', event => {
    const choice=dialog.showMessageBoxSync(window,{type:'question',buttons:['Продолжить редактирование','Закрыть без сохранения'],defaultId:0,cancelId:0,title:'Есть неприменённые изменения',message:'Закрыть приложение и отменить черновики настроек?'});
    if(choice===1) event.preventDefault();
  });
  const allowed = isDevMode() ? new URL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173').origin : serverUrl;
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== allowed) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  protectWindow(window);
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[electron] Ошибка загрузки страницы:', errorCode, errorDescription, validatedURL);
  });
  if (isDevMode()) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');
  } else {
    window.loadURL(serverUrl);
  }
}

function registerIpc() {
  const handle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    const allowedOrigin = isDevMode() ? new URL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173').origin : serverUrl;
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== allowedOrigin) throw new Error('Untrusted IPC sender.');
    return handler(event, ...args);
  });
  handle('app:version', () => app.getVersion());
  handle('app:userData', () => app.getPath('userData'));

  handle('twitch:login', async () => {
    return new Promise((resolve) => {
      const authWindow = new BrowserWindow({
        width: 520,
        height: 720,
        title: 'Вход через Twitch',
        parent: BrowserWindow.getFocusedWindow() || undefined,
        modal: true,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      const authUrl = 'https://id.twitch.tv/oauth2/authorize?client_id=q6batx0epp608jehkipdgrm6cfhgah&redirect_uri=https://twitchapps.com/tmi/&response_type=token&scope=chat:read+chat:edit';
      let resolved = false;

      const handleCallback = async (rawUrl) => {
        if (!rawUrl.includes('access_token=') || resolved) return;
        resolved = true;
        try {
          const hash = rawUrl.substring(rawUrl.indexOf('#') + 1);
          const params = new URLSearchParams(hash);
          const accessToken = params.get('access_token');
          if (!accessToken) {
            resolve({ ok: false, error: 'Токен не найден в ответе' });
            authWindow.close();
            return;
          }

          const formattedToken = `oauth:${accessToken}`;

          // Query user login from Twitch API
          let login = '';
          try {
            const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
              headers: { Authorization: `OAuth ${accessToken}` },
            });
            if (validateRes.ok) {
              const data = await validateRes.json();
              login = data.login || '';
            }
          } catch {
            // ignore validation error
          }

          resolve({
            ok: true,
            username: login,
            channel: login,
            token: formattedToken,
          });
        } catch (e) {
          resolve({ ok: false, error: e.message });
        } finally {
          authWindow.close();
        }
      };

      authWindow.webContents.on('will-navigate', (_event, url) => {
        void handleCallback(url);
      });
      authWindow.webContents.on('will-redirect', (_event, url) => {
        void handleCallback(url);
      });
      authWindow.webContents.on('did-navigate', (_event, url) => {
        void handleCallback(url);
      });

      authWindow.on('closed', () => {
        if (!resolved) {
          resolve({ ok: false, error: 'Авторизация отменена.' });
        }
      });

      void authWindow.loadURL(authUrl);
    });
  });

  let avatarWindow = null;

  handle('avatar:open-window', () => {
    if (avatarWindow && !avatarWindow.isDestroyed()) {
      avatarWindow.focus();
      return { ok: true, alreadyOpen: true };
    }

    avatarWindow = new BrowserWindow({
      width: 520,
      height: 720,
      transparent: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      resizable: true,
      title: 'AI VTuber Avatar Overlay',
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.cjs'),
      },
    });

    protectWindow(avatarWindow);
    if (isDevMode()) {
      avatarWindow.loadURL((process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173') + '?view=avatar');
    } else {
      avatarWindow.loadURL(`${serverUrl}/?view=avatar`);
    }

    avatarWindow.on('closed', () => {
      avatarWindow = null;
    });

    return { ok: true };
  });

  handle('avatar:close-window', () => {
    if (avatarWindow && !avatarWindow.isDestroyed()) {
      avatarWindow.close();
      avatarWindow = null;
    }
    return { ok: true };
  });

  handle('avatar:is-open', () => {
    return Boolean(avatarWindow && !avatarWindow.isDestroyed());
  });

  handle('avatar:select-model', async () => {
    const focusedWin = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(focusedWin || undefined, {
      title: 'Выберите Live2D модель или ZIP-архив',
      properties: ['openFile'],
      filters: [
        { name: 'Live2D модели и архивы (*.model3.json, *.zip)', extensions: ['json', 'zip'] },
        { name: 'ZIP архивы (*.zip)', extensions: ['zip'] },
        { name: 'Файлы модели Live2D (*.json)', extensions: ['json'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const selectedPath = result.filePaths[0];

    // If ZIP archive:
    if (selectedPath.toLowerCase().endsWith('.zip')) {
      try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(selectedPath);
        const baseName = path.basename(selectedPath, path.extname(selectedPath)).replace(/[^a-zA-Z0-9_\-\u0400-\u04FF]/g, '_');
        const modelsDir = path.join(app.getPath('userData'), 'models', baseName);
        fs.mkdirSync(modelsDir, { recursive: true });

        zip.extractAllTo(modelsDir, true);

        // Recursive search for .model3.json or model.json
        const findModelFile = (dir) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              const res = findModelFile(fullPath);
              if (res) return res;
            } else if (entry.isFile()) {
              const lower = entry.name.toLowerCase();
              if (lower.endsWith('.model3.json') || lower.endsWith('model.json')) {
                return fullPath;
              }
            }
          }
          return null;
        };

        const modelFile = findModelFile(modelsDir);
        if (modelFile) {
          return {
            ok: true,
            modelPath: modelFile,
            extracted: true,
            folder: modelsDir,
            modelName: path.basename(modelFile),
          };
        } else {
          return {
            ok: false,
            error: 'В архиве не найден конфигурационный файл модели (*.model3.json или model.json).',
          };
        }
      } catch (err) {
        return {
          ok: false,
          error: `Ошибка при распаковке ZIP-архива: ${err.message}`,
        };
      }
    }

    // Direct model file
    return {
      ok: true,
      modelPath: selectedPath,
      extracted: false,
      modelName: path.basename(selectedPath),
    };
  });
}

app.whenReady().then(async () => {
  await startServer();
  registerIpc();
  createWindow();
  watchBackend();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(async error => {
  quitting = true;
  dialog.showErrorBox('AI VTuber — startup failed', error.message);
  await stopServer(); app.exit(1);
});

app.on('before-quit', event => {
  if (quitting) return;
  const windows=BrowserWindow.getAllWindows();
  if(windows.length){
    // Let every renderer resolve beforeunload before committing to shutdown.
    event.preventDefault();
    for(const window of windows)window.close();
    if(!quitting&&BrowserWindow.getAllWindows().length===0)app.quit();
    return;
  }
  event.preventDefault(); quitting = true;
  clearTimeout(reloadTimer); for (const watcher of watchers) watcher.close();
  void stopServer().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
