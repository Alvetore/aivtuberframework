// Run with Electron, using a caller-owned temporary profile. Never uses the user's profile or .env.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const childProcesses = require('node:child_process');

const phase = process.env.VTUBER_SMOKE_PHASE;
const supplied = process.env.VTUBER_SMOKE_DIR;
const fakeSecrets = {
  twitchOauthToken: 'oauth:vtuber-smoke-fake-twitch',
  llmApiKey: 'vtuber-smoke-fake-llm',
  openaiTtsApiKey: 'vtuber-smoke-fake-openai-tts',
  elevenlabsApiKey: 'vtuber-smoke-fake-elevenlabs',
};
let failed = false;
let completed = false;
let deadline;
let backendExit;
let backendStarted = false;
let backendStarts = 0;
const readyBackends = new Set();
const backendExits = new Map();
let touchedSource;
let originalSourceTimes;
const visual=process.env.VTUBER_SMOKE_VISUAL==='1';
let fixtureServer;

function restoreSourceTimes() {
  if (!touchedSource || !originalSourceTimes) return;
  fs.utimesSync(touchedSource, originalSourceTimes.atime, originalSourceTimes.mtime);
  touchedSource = undefined;
  originalSourceTimes = undefined;
}

function report(error) {
  if (failed) return;
  failed = true;
  clearTimeout(deadline);
  let message = error instanceof Error ? error.message : String(error);
  for (const value of Object.values(fakeSecrets)) message = message.split(value).join('[redacted]');
  console.error(JSON.stringify({ smoke: 'electron', phase, ok: false, error: message.slice(0, 500) }));
  process.exitCode = 1;
  app.quit();
  // A failed backend startup must not leave this test running indefinitely.
  setTimeout(() => app.exit(1), 6000).unref();
}

try {
  if (!['save', 'clear', 'verify'].includes(phase)) throw new Error('VTUBER_SMOKE_PHASE must be save, clear or verify.');
  if (!supplied) throw new Error('VTUBER_SMOKE_DIR is required.');
  const directory = fs.realpathSync(path.resolve(supplied));
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  if (path.dirname(directory).toLowerCase() !== temporaryRoot.toLowerCase() || !path.basename(directory).startsWith('vtuber-electron-smoke-')) {
    throw new Error('Smoke profile must be a direct temporary-directory child named vtuber-electron-smoke-*.');
  }
  if (!fs.statSync(directory).isDirectory()) throw new Error('Smoke profile is not a directory.');
  app.setPath('userData', directory);
  for (const key of ['TWITCH_OAUTH_TOKEN', 'LLM_API_KEY', 'OPENAI_TTS_API_KEY', 'ELEVENLABS_API_KEY']) process.env[key] = '';
  delete process.env.NODE_ENV;
  // Main loads .env itself; prevent access to it while preserving its normal startup flow.
  process.loadEnvFile = () => undefined;
  const originalSpawn = childProcesses.spawn;
  childProcesses.spawn = (...args) => {
    if (args[2]?.stdio?.includes('ipc')) {
      // Development normally uses the workspace DB; force only this test child into its guarded profile.
      args[2].env = { ...args[2].env, ELECTRON_USER_DATA: directory };
      if (args[2].env.ELECTRON_USER_DATA !== directory) throw new Error('Smoke backend database path is not isolated.');
    }
    const child = originalSpawn(...args);
    if (args[2]?.stdio?.includes('ipc')) {
      backendStarted = true;
      const sequence = ++backendStarts;
      backendExit = undefined;
      child.on('message', message => { if (message?.type === 'server:ready') readyBackends.add(sequence); });
      child.once('exit', (code, signal) => {
        backendExits.set(sequence, { code, signal });
        if (sequence === backendStarts) backendExit = { code, signal };
      });
    }
    return child;
  };
  dialog.showErrorBox = (_title, message) => report(new Error(message));
  process.on('uncaughtException', report);
  process.on('unhandledRejection', report);
  deadline = setTimeout(() => report(new Error('Electron smoke exceeded its deadline.')), visual?180_000:60_000);

  let testing = false;
  app.on('browser-window-created', (_event, window) => {
    if(!visual){window.hide();window.on('show', () => window.hide());}
    if (testing) return;
    testing = true;
    window.webContents.once('did-finish-load', () => void run(window).catch(report));
    window.webContents.once('did-fail-load', (_event, code) => report(new Error(`Main window failed to load (${code}).`)));
  });
  app.on('will-quit', () => {
    // Main closes its development watchers during before-quit; restore without another reload.
    try { restoreSourceTimes(); }
    catch { process.exitCode = 1; console.error(JSON.stringify({ smoke: 'electron', phase, ok: false, error: 'Could not restore source timestamps.' })); }
    if (!completed && !failed) {
      process.exitCode = 1;
      console.error(JSON.stringify({ smoke: 'electron', phase, ok: false, error: 'Application quit before smoke completed.' }));
    } else if (completed && !failed) {
      if (!backendStarted || !backendExit || backendExit.code !== 0 || backendExit.signal !== null) {
        process.exitCode = 1;
        console.error(JSON.stringify({ smoke: 'electron', phase, ok: false, error: 'Backend did not exit cleanly.' }));
      } else console.log(JSON.stringify({ smoke: 'electron', phase, shutdown: 'clean' }));
    }
  });
  process.on('exit', () => {
    // Also restore if Electron exits through app.exit during startup/test failure.
    try { restoreSourceTimes(); } catch { process.exitCode = 1; }
  });
  require('../src/electron/main.cjs');
} catch (error) {
  report(error);
}

async function inWindow(window, operation, argument) {
  return window.webContents.executeJavaScript(`(${operation.toString()})(${JSON.stringify(argument)})`);
}

async function run(window) {
  const origin = new URL(window.webContents.getURL()).origin;
  if (!origin.startsWith('http://127.0.0.1:')) throw new Error('Main UI is not served by the local HTTP backend.');
  let loaded = false;
  for (let attempt = 0; attempt < 70; attempt++) {
    loaded = await inWindow(window, () => Boolean(document.querySelector('nav button') && document.querySelector('.ws-open')));
    if (loaded) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!loaded) throw new Error('React application or authenticated WebSocket did not become ready.');
  const before = await inWindow(window, async () => {
    const response = await fetch('/api/settings');
    if (!response.ok) throw new Error(`Same-origin settings failed (${response.status}).`);
    const settings = await response.json();
    return {
      hasSecretBridge: 'secrets' in window,
      masks: Object.fromEntries(['twitchOauthToken', 'llmApiKey', 'openaiTtsApiKey', 'elevenlabsApiKey'].map(key => [key, settings[key]])),
    };
  });
  if (before.hasSecretBridge) throw new Error('Raw secrets are exposed through the renderer bridge.');
  const keys = Object.keys(fakeSecrets);
  if (phase === 'clear' && !keys.every(key => before.masks[key] === '***')) throw new Error('Saved secrets did not survive application restart.');
  if (phase === 'verify' && !keys.every(key => before.masks[key] === '')) throw new Error('Deleted secrets returned after application restart.');

  if (phase === 'save') {
    await inWindow(window, async (values) => {
      const keys = Object.keys(values);
      const socket = new WebSocket(`${location.origin.replace('http:', 'ws:')}/ws`);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Authenticated WebSocket snapshot timed out.')), 2500);
          socket.onerror = () => { clearTimeout(timer); reject(new Error('Authenticated WebSocket failed.')); };
          socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.type === 'snapshot' && message.serverInstanceId && message.payload.serverInstanceId===message.serverInstanceId) { clearTimeout(timer); resolve(); }
          };
        });
        const broadcast = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Settings broadcast timed out.')), 2500);
          socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (keys.some(key => JSON.stringify(message).includes(values[key]))) {
              clearTimeout(timer); reject(new Error('A raw key appeared in a WebSocket event.')); return;
            }
            if (message.type === 'settings') {
              clearTimeout(timer);
              if (!keys.every(key => message.payload[key] === '***')) reject(new Error('Settings broadcast did not mask every key.'));
              else resolve();
            }
          };
        });
        const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, mode: 'reactive', ttsEnabled: false, avatarMode: 'disabled' }) });
        if (!response.ok) throw new Error(`Saving settings failed (${response.status}).`);
        const saved = await response.json();
        if (!keys.every(key => saved[key] === '***')) throw new Error('Settings API did not mask every saved key.');
        await broadcast;
        await window.avatarControl.openWindow();
        return true;
      } finally { socket.close(); }
    }, fakeSecrets);
    const overlay = BrowserWindow.getAllWindows().find(candidate => candidate !== window);
    if (!overlay) throw new Error('Avatar overlay window was not created.');
    let overlayReady = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const overlayUrl = overlay.webContents.getURL();
      if (!overlay.webContents.isLoading() && overlayUrl.startsWith(`${origin}/`)) {
        overlayReady = await inWindow(overlay, () => Boolean(document.querySelector('svg')));
        if (overlayReady) break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!overlayReady) throw new Error('Same-origin avatar overlay did not render.');
    if(await inWindow(overlay,()=>Boolean(document.querySelector('.overlay-controls'))))throw new Error('Clean OBS overlay contains controls.');
    await inWindow(window, async () => { await window.avatarControl.closeWindow(); });
    await checkWorkspace(window);
    if (process.argv.includes('--dev')) await checkDevReload(window, keys);
    await checkResponsive(window);
    if(visual){
      window.setSize(1280,820);window.show();
      console.log(JSON.stringify({smoke:'visual',profile:supplied,ready:true}));
      await new Promise(resolve=>{const timer=setInterval(()=>{if(fs.existsSync(path.join(supplied,'visual-done'))){clearInterval(timer);resolve();}},200);});
    }
  } else if (phase === 'clear') {
    await inWindow(window, async (keys) => {
      const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(keys.map(key => [key, '']))) });
      if (!response.ok) throw new Error(`Clearing settings failed (${response.status}).`);
      const settings = await response.json();
      if (!keys.every(key => settings[key] === '')) throw new Error('Cleared keys remain configured.');
      const statusResponse = await fetch('/api/status');
      const status = await statusResponse.json();
      if (status.llm !== 'unconfigured') throw new Error('LLM remains configured after key deletion.');
    }, keys);
  }
  completed = true;
  fixtureServer?.close();
  clearTimeout(deadline);
  console.log(JSON.stringify({ smoke: 'electron', phase, ok: true, ui: 'loaded', sameOriginApi: true, authenticatedWebSocket: true, rawSecretBridge: false, ...(phase === 'save' ? { masks: 'verified', broadcast: 'masked', avatar: 'same-origin', ...(process.argv.includes('--dev') ? { devReload: true } : {}) } : { persistedState: 'verified' }) }));
  app.quit();
}

async function checkWorkspace(window){
  const http=require('node:http');
  fixtureServer=http.createServer((request,response)=>{
    if(request.url.endsWith('/models')){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({data:[{id:'smoke-model'}]}));return;}
    let raw='';request.on('data',chunk=>{raw+=chunk;});request.on('end',()=>{
      const input=JSON.parse(raw||'{}');const text=input.messages?.at(-1)?.content??'';
      const send=()=>{if(response.destroyed)return;response.setHeader('Content-Type','application/json');if(text.includes('smoke-error')){response.statusCode=401;response.end(JSON.stringify({error:'fixture rejection'}));}else response.end(JSON.stringify({choices:[{message:{content:'Fixture response: '+text}}],usage:{prompt_tokens:8,completion_tokens:5,total_tokens:13}}));};
      if(text.includes('smoke-slow'))setTimeout(send,700);else send();
    });
  });
  await new Promise(resolve=>fixtureServer.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${fixtureServer.address().port}/v1`;
  await inWindow(window,async endpoint=>{
    const read=async(path,method='GET',body)=>{const res=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});if(!res.ok)throw new Error(`${path}: ${res.status}`);return res.json();};
    const poll=async id=>{for(let i=0;i<60;i++){const s=await read('/api/snapshot');const op=s.operations.find(o=>o.id===id);if(op&&op.outcome!=='pending')return {s,op};await new Promise(r=>setTimeout(r,25));}throw new Error('Operation did not terminate.');};
    let s=await read('/api/snapshot');if(s.runtime.state!=='stopped')throw new Error('Runtime did not begin stopped.');
    const denied=await fetch('/api/runtime/start',{method:'POST'});if(denied.status!==409)throw new Error('Live start without Twitch was accepted.');
    await read('/api/settings','PUT',{llmEndpoint:endpoint,llmModel:'smoke-model',ttsEnabled:false});
    await read('/api/llm/models','POST',{endpoint:endpoint+'/draft',apiKey:'different-fake-draft'});
    s=await read('/api/snapshot');if(s.checks.llm.state!=='configured')throw new Error('Draft check changed saved connection readiness.');
    await read('/api/llm/models','POST',{});s=await read('/api/snapshot');if(s.checks.llm.state!=='api_verified')throw new Error('Model-list check not distinguished.');
    const accepted=await read('/api/test-message','POST',{text:'smoke-success'});const done=await poll(accepted.operationId);
    if(done.op.outcome!=='completed'||done.op.usage.totalTokens!==13||done.op.attempts!==1)throw new Error('Test response/actual metrics failed.');
    const reply=done.s.feed.find(m=>m.operationId===accepted.operationId);const original=done.s.feed.find(m=>m.id===done.op.messageId);
    if(!reply?.replyToId||reply.replyToId!==original?.id||original.username!=='Тестовый зритель'||reply.source!=='test')throw new Error('Author/reply provenance was lost.');
    const error=await read('/api/test-message','POST',{text:'smoke-error'});if((await poll(error.operationId)).op.outcome!=='failed')throw new Error('Provider failure reported success.');
    const slow=await read('/api/test-message','POST',{text:'smoke-slow'});await read('/api/runtime/interrupt','POST');await new Promise(r=>setTimeout(r,850));s=await read('/api/snapshot');
    if(s.operations.find(o=>o.id===slow.operationId)?.outcome!=='cancelled'||s.feed.some(m=>m.operationId===slow.operationId))throw new Error('Late reply survived interruption.');
    const first=s.runtime.profileId;
    const exported=await read(`/api/profiles/${first}/export`);const json=JSON.stringify(exported);
    if(/llmApiKey|twitchOauthToken|openaiTtsApiKey|elevenlabsApiKey|live2dModelPath|audioOutputDeviceId|legacy_context/.test(json))throw new Error('Profile export included private/global fields.');
    const count=s.profiles.length;
    const invalid=await fetch('/api/profiles/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...exported,settings:{...exported.settings,llmApiKey:'forbidden'}})});
    if(invalid.status!==400||(await read('/api/profiles')).length!==count)throw new Error('Invalid import changed profiles.');
    const other=await read('/api/profiles','POST',{name:'Smoke second character'});await read(`/api/profiles/${other.id}/select`,'POST',{});s=await read('/api/snapshot');
    if(s.feed.length||s.operations.length||s.runtime.state!=='stopped')throw new Error('New profile inherited old history.');
    await read(`/api/profiles/${first}/select`,'POST',{});
    const socket=new WebSocket(location.origin.replace('http:','ws:')+'/ws');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WS snapshot missing')),2000);socket.onmessage=event=>{const e=JSON.parse(event.data);if(e.type==='snapshot'){clearTimeout(timer);resolve();}};});socket.send('{malformed');socket.close();
  },endpoint);
  await checkDraftNavigation(window);
}

async function checkDraftNavigation(window){
  await inWindow(window,async()=>{
    const navigate=async label=>{const button=[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes(label));if(!button)throw new Error('Missing navigation '+label);button.click();await new Promise(r=>setTimeout(r,60));};
    await navigate('Персонаж');const input=document.querySelector('input[name="characterName"]');if(!input)throw new Error('Character form not mounted.');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Unsaved smoke draft');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,30));
    await navigate('Голос');await navigate('Персонаж');
    if(document.querySelector('input[name="characterName"]').value!=='Unsaved smoke draft')throw new Error('Navigation lost the draft.');
    const response=await fetch('/api/settings');if((await response.json()).characterName==='Unsaved smoke draft')throw new Error('Draft was applied without permission.');
  });
  const originalPrompt=dialog.showMessageBoxSync;
  let prompts=0;dialog.showMessageBoxSync=()=>{prompts++;return 0;};
  try{
    app.quit();
    for(let i=0;i<30&&!prompts;i++)await new Promise(r=>setTimeout(r,50));
    if(!prompts||window.isDestroyed())throw new Error('Dirty-draft quit decision was not respected.');
    await inWindow(window,async()=>{const response=await fetch('/api/health');if(!response.ok)throw new Error('Cancelling Quit stopped the backend.');});
  }finally{dialog.showMessageBoxSync=originalPrompt;}
  await inWindow(window,async()=>{
    const cancel=[...document.querySelectorAll('button')].find(b=>b.textContent==='Отменить изменения');cancel.click();await new Promise(r=>setTimeout(r,30));document.querySelector('nav button').click();
  });
}

async function checkResponsive(window){
  for(const [width,height,zoom] of [[960,640,1],[1280,820,1.25],[1280,820,1.5]]){
    window.setSize(width,height);window.webContents.setZoomFactor(zoom);
    const result=await inWindow(window,async()=>{
      for(const button of [...document.querySelectorAll('nav button')]){button.click();await new Promise(r=>setTimeout(r,50));if(document.documentElement.scrollWidth>innerWidth+2)return {page:button.textContent,width:innerWidth,scroll:document.documentElement.scrollWidth};}
      document.querySelector('nav button').click();return null;
    });
    if(result)throw new Error('Horizontal page overflow: '+JSON.stringify({...result,width,height,zoom}));
  }
  window.webContents.setZoomFactor(1);window.setSize(1280,820);
}

async function checkDevReload(window, keys) {
  const previous = backendStarts;
  await inWindow(window, () => {
    const state = { disconnected: false };
    const observer = new MutationObserver(() => { if (!document.querySelector('.ws-open')) state.disconnected = true; });
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
    window.__vtuberSmokeReload = { state, observer,instance:document.querySelector('[data-server-instance]').dataset.serverInstance };
    [...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Персонаж')).click();
  });
  await inWindow(window,async()=>{
    await new Promise(r=>setTimeout(r,40));const input=document.querySelector('[name="characterName"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Reload draft sentinel');input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  touchedSource = path.resolve(__dirname, '../src/server/event-bus.ts');
  const before = fs.statSync(touchedSource);
  originalSourceTimes = { atime: before.atime, mtime: before.mtime };
  // Change only metadata; production source bytes remain untouched.
  fs.utimesSync(touchedSource, before.atime, new Date(Math.max(Date.now(), before.mtimeMs + 1000)));
  let reconnected = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (backendStarts > previous && readyBackends.has(backendStarts)) {
      const exit = backendExits.get(previous);
      if (!exit || exit.code !== 0 || exit.signal !== null) throw new Error('Development reload did not stop the previous backend cleanly.');
      reconnected = await inWindow(window, async (keys) => {
        try {
          const response = await fetch('/api/settings');
          if (!response.ok) return false;
          const settings = await response.json();
          return keys.every(key => settings[key] === '***') && Boolean(document.querySelector('.ws-open')) && window.__vtuberSmokeReload.state.disconnected && document.querySelector('[data-server-instance]').dataset.serverInstance!==window.__vtuberSmokeReload.instance && document.querySelector('[name="characterName"]').value==='Reload draft sentinel';
        } catch { return false; }
      }, keys);
      if (reconnected) break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await inWindow(window, () => {
    window.__vtuberSmokeReload.observer.disconnect();
    delete window.__vtuberSmokeReload;
    [...document.querySelectorAll('button')].find(b=>b.textContent==='Отменить изменения').click();document.querySelector('nav button').click();
  });
  if (!reconnected) throw new Error('Development backend reload, API readiness or WebSocket reconnection failed.');
}
