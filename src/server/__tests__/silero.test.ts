import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { EventBus } from '../event-bus.js';
import { registerSileroRoutes } from '../silero.js';
import { defaultSettings } from '../../shared/types.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('node:net', async (original) => ({ ...await original<typeof import('node:net')>(), createServer: vi.fn() }));
const actualPlatform = process.platform;

class FakeChild extends EventEmitter {
  pid: number | undefined = 98765;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stopped = false;
  kill = vi.fn(() => {
    this.stopped = true;
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  });
}

describe('Silero process ownership', () => {
  let app: ReturnType<typeof Fastify>;
  let child: FakeChild;
  let available: boolean;
  let configuredPort: number;
  let cleanup: () => Promise<void>;

  beforeEach(() => {
    available = true;
    configuredPort = 5000;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    child = new FakeChild();
    vi.mocked(spawn).mockReset().mockReturnValue(child as unknown as ChildProcess);
    vi.mocked(execFile).mockReset().mockImplementation(((...args: unknown[]) => {
      const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
      queueMicrotask(() => { child.stopped = true; child.emit('exit', 0); callback(null, '', ''); });
      return child as unknown as ChildProcess;
    }) as typeof execFile);
    vi.mocked(createServer).mockReset().mockImplementation(() => {
      const probe = new EventEmitter() as EventEmitter & { listen: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
      probe.listen = vi.fn((_port, _host, callback) => {
        queueMicrotask(() => available ? callback() : probe.emit('error', Object.assign(new Error('busy'), { code: 'EADDRINUSE' })));
        return probe;
      });
      probe.close = vi.fn((callback) => callback());
      return probe as unknown as ReturnType<typeof createServer>;
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', device: 'cpu', speakers: ['xenia'] }))));
    app = Fastify();
    cleanup = registerSileroRoutes(app, new EventBus(), () => ({ ...defaultSettings, sileroEndpoint: `http://127.0.0.1:${configuredPort}` }));
  });

  afterEach(async () => {
    await cleanup();
    await app.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: actualPlatform });
  });

  it('reports an occupied port without spawning or terminating any process', async () => {
    available = false;
    const result = await app.inject({ method: 'POST', url: '/api/tts/silero/start' });
    expect(result.statusCode).toBe(409);
    expect(result.json().error).toContain('Порт 5000 занят');
    expect(spawn).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses to stop an externally started healthy server and never calls shutdown', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/tts/silero/stop' });
    expect(result.statusCode).toBe(409);
    expect(result.json()).toMatchObject({ ok: false, running: true });
    expect(child.kill).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://127.0.0.1:5000/health');
  });

  it('starts Python without a shell and kills only its PID tree even when configured on port 50000', async () => {
    configuredPort = 50000;
    const result = await app.inject({ method: 'POST', url: '/api/tts/silero/start' });
    expect(result.statusCode).toBe(200);
    expect(spawn).toHaveBeenCalledWith('python', [expect.stringMatching(/silero_server\.py$/)], expect.objectContaining({
      shell: false,
      windowsHide: true,
      env: expect.objectContaining({ SILERO_PORT: '50000' }),
    }));
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
    const stop = await app.inject({ method: 'POST', url: '/api/tts/silero/stop' });
    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toEqual({ ok: true, running: false });
    expect(execFile).toHaveBeenCalledWith('taskkill', ['/PID', '98765', '/T', '/F'], expect.objectContaining({ windowsHide: true, shell: false }), expect.any(Function));
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('coalesces concurrent starts into one owned child', async () => {
    const results = await Promise.all([
      app.inject({ method: 'POST', url: '/api/tts/silero/start' }),
      app.inject({ method: 'POST', url: '/api/tts/silero/start' }),
    ]);
    expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('does not report successful startup after a concurrent stop', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await waiting;
      return new Response(JSON.stringify({ status: 'ok', device: 'cpu' }));
    }).mockResolvedValue(new Response('{}', { status: 503 }));
    const start = app.inject({ method: 'POST', url: '/api/tts/silero/start' });
    // Start the lazy inject promise before waiting for spawn.
    const result = Promise.resolve(start);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    const stop = await app.inject({ method: 'POST', url: '/api/tts/silero/stop' });
    release();
    expect(stop.statusCode).toBe(200);
    expect((await result).statusCode).toBe(409);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it('reports failed tree termination without claiming success or killing only the parent', async () => {
    await app.inject({ method: 'POST', url: '/api/tts/silero/start' });
    vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
      const callback = args[3] as (error: Error | null) => void;
      queueMicrotask(() => callback(new Error('taskkill failed')));
      return child as unknown as ChildProcess;
    }) as typeof execFile);
    const result = await app.inject({ method: 'POST', url: '/api/tts/silero/stop' });
    expect(result.statusCode).toBe(500);
    expect(result.json()).toMatchObject({ ok: false, running: true });
    expect(child.kill).not.toHaveBeenCalled();
    child.stopped = true;
    child.emit('exit', 0);
  });

  it('never invokes taskkill with a missing or invalid child PID', async () => {
    child.pid = undefined;
    await app.inject({ method: 'POST', url: '/api/tts/silero/start' });
    const result = await app.inject({ method: 'POST', url: '/api/tts/silero/stop' });
    expect(result.statusCode).toBe(500);
    expect(execFile).not.toHaveBeenCalled();
    child.emit('exit', 0);
  });

  it('does not issue a tree kill after the owned process has exited', async () => {
    await app.inject({ method: 'POST', url: '/api/tts/silero/start' });
    child.emit('exit', 0);
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
    expect((await app.inject({ method: 'POST', url: '/api/tts/silero/stop' })).statusCode).toBe(200);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('uses the owned process handle on non-Windows platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    await app.inject({ method: 'POST', url: '/api/tts/silero/start' });
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
    expect((await app.inject({ method: 'POST', url: '/api/tts/silero/stop' })).statusCode).toBe(200);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(execFile).not.toHaveBeenCalled();
  });
});
