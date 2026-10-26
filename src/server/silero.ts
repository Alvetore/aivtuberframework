import type { FastifyInstance } from 'fastify';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventBus } from './event-bus.js';
import type { Settings } from '../shared/types.js';

interface SileroStatus { running: boolean; gpu?: boolean; speakers?: string[] }
interface OwnedProcess {
  child: ChildProcess;
  endpoint: string;
  exited: boolean;
  exit: Promise<void>;
  termination?: Promise<boolean>;
}

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
      else reject(error);
    });
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/** Owns only the Python process started here; never terminates a port's occupant. */
export function registerSileroRoutes(
  app: FastifyInstance,
  bus: EventBus,
  getSettings: () => Settings,
): () => Promise<void> {
  let owned: OwnedProcess | null = null;
  let starting: Promise<{ code: number; body: Record<string, unknown> }> | null = null;
  let generation = 0;
  const endpoint = () => (getSettings().sileroEndpoint || 'http://127.0.0.1:5000').replace(/\/$/, '');
  const log = (level: 'info' | 'error', message: string) => bus.emit('LOG', { level, source: 'Silero', message });

  async function status(url = endpoint()): Promise<SileroStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    try {
      const response = await fetch(`${url}/health`, { signal: controller.signal });
      if (!response.ok) return { running: false };
      const data = await response.json() as { status?: string; device?: string; speakers?: unknown };
      if (data.status !== 'ok') return { running: false };
      return {
        running: true,
        gpu: data.device === 'cuda',
        speakers: Array.isArray(data.speakers) ? data.speakers.filter((v): v is string => typeof v === 'string') : [],
      };
    } catch {
      return { running: false };
    } finally {
      clearTimeout(timer);
    }
  }

  async function terminateOwned(current: OwnedProcess): Promise<boolean> {
    if (current.exited) return true;
    if (process.platform === 'win32') {
      const pid = current.child.pid;
      if (!Number.isInteger(pid) || !pid || pid <= 0) {
        log('error', 'Нельзя остановить дерево Silero: отсутствует корректный PID принадлежащего приложению процесса.');
        return false;
      }
      // Python can own pip during dependency installation. Target only this live child's tree.
      const killed = await new Promise<boolean>((resolve) => {
        if (current.exited) return resolve(true);
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false, timeout: 2500 }, (error) => {
          if (error) log('error', 'Не удалось завершить принадлежащее приложению дерево процессов Silero.');
          resolve(!error);
        });
      });
      // Do not hide a failed tree termination behind a successful parent-only kill.
      if (!killed) return false;
    } else {
      current.child.kill('SIGTERM');
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([current.exit, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1500); })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!current.exited && process.platform !== 'win32') {
      current.child.kill('SIGKILL');
      try {
        await Promise.race([current.exit, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000); })]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return current.exited;
  }

  async function terminate(current: OwnedProcess): Promise<boolean> {
    if (current.exited) return true;
    if (current.termination) return current.termination;
    const operation = terminateOwned(current);
    current.termination = operation;
    try { return await operation; }
    finally { current.termination = undefined; }
  }

  async function start() {
    const epoch = generation;
    let url: URL;
    try { url = new URL(endpoint()); }
    catch { return { code: 400, body: { ok: false, error: 'Некорректный адрес Silero.' } }; }
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      return { code: 400, body: { ok: false, error: 'Автозапуск Silero поддерживает только локальный HTTP-адрес без пути.' } };
    }
    const port = Number(url.port || '80');
    // Python binds IPv4 loopback; use the same address for readiness checks.
    const target = `http://127.0.0.1:${port}`;
    if (owned && !owned.exited) {
      if (owned.endpoint !== target) return { code: 409, body: { ok: false, error: 'Сначала остановите запущенный приложением Silero перед сменой адреса.' } };
      const current = await status(target);
      return current.running
        ? { code: 200, body: { ok: true, ...current } }
        : { code: 409, body: { ok: false, error: 'Процесс Silero уже запущен, но пока не отвечает.' } };
    }
    if (!await portAvailable(port)) {
      return { code: 409, body: { ok: false, error: `Порт ${port} занят другим процессом. Приложение не будет его завершать.` } };
    }
    if (epoch !== generation) return { code: 409, body: { ok: false, error: 'Запуск Silero отменён.' } };
    const script = process.env.SILERO_SCRIPT_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/silero_server.py');
    if (!existsSync(script)) return { code: 500, body: { ok: false, error: 'Скрипт Silero не найден.' } };
    log('info', 'Запуск Silero TTS сервера...');
    const child = spawn('python', [script], {
      cwd: path.dirname(script),
      env: { ...process.env, SILERO_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    let finish!: () => void;
    const current: OwnedProcess = { child, endpoint: target, exited: false, exit: new Promise<void>((resolve) => { finish = resolve; }) };
    owned = current;
    const exited = () => {
      current.exited = true;
      if (owned === current) owned = null;
      finish();
    };
    child.once('error', (error) => { log('error', `Ошибка запуска Silero: ${error.message}`); exited(); });
    child.once('exit', (code) => { log('info', `Процесс Silero завершился (код ${code}).`); exited(); });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n').filter(Boolean)) log('info', line.trim());
      });
    }
    for (let i = 0; i < 40; i++) {
      if (epoch !== generation) return { code: 409, body: { ok: false, error: 'Запуск Silero отменён.' } };
      if (current.exited) return { code: 500, body: { ok: false, error: 'Процесс Silero завершился до готовности.' } };
      const ready = await status(target);
      if (epoch !== generation || current.exited) continue;
      if (ready.running) {
        log('info', `Silero готов к работе на ${ready.gpu ? 'GPU (CUDA)' : 'CPU'}.`);
        return { code: 200, body: { ok: true, ...ready } };
      }
      await Promise.race([current.exit, new Promise<void>((resolve) => setTimeout(resolve, 1000))]);
    }
    await terminate(current);
    return { code: 504, body: { ok: false, error: 'Таймаут ожидания запуска Silero сервера.' } };
  }

  app.get('/api/tts/silero/status', async () => status());
  app.post('/api/tts/silero/start', async (_request, reply) => {
    if (!starting) starting = start().finally(() => { starting = null; });
    const result = await starting;
    return reply.code(result.code).send(result.body);
  });
  app.post('/api/tts/silero/stop', async (_request, reply) => {
    generation++;
    const current = owned;
    if (current) {
      if (!await terminate(current)) return reply.code(500).send({ ok: false, running: true, error: 'Не удалось остановить принадлежащий приложению процесс Silero.' });
      // Check the endpoint that belonged to the process, even if settings changed.
      const remaining = await status(current.endpoint);
      if (remaining.running) return reply.code(409).send({ ok: false, ...remaining, error: 'Процесс приложения остановлен, но адрес обслуживает другой сервер.' });
      log('info', 'Сервер Silero остановлен.');
      return { ok: true, running: false };
    }
    const external = await status();
    if (external.running) return reply.code(409).send({ ok: false, ...external, error: 'Сервер запущен вне приложения. Остановите его самостоятельно.' });
    return { ok: true, running: false };
  });

  return async () => {
    generation++;
    if (owned) {
      const current = owned;
      if (!await terminate(current)) throw new Error('Не удалось остановить процесс Silero.');
    }
  };
}
