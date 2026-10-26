import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Socket } from 'node:net';
import { registerLocalAccess } from '../local-access.js';
import { registerLocalFiles } from '../local-files.js';

const token = 'a'.repeat(64);
const cookie = `vtuber_session=${token}`;

describe('local server access and files', () => {
  let app: FastifyInstance;
  let directory: string;
  let host: string;
  let origin: string;
  let modelDirectory: string;
  let connections: number;
  let sockets: Set<Socket>;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'vtuber-security-test-'));
    modelDirectory = path.join(directory, 'models');
    await mkdir(modelDirectory);
    await mkdir(path.join(directory, 'models-other'));
    await mkdir(path.join(modelDirectory, 'textures'));
    await mkdir(path.join(modelDirectory, 'motions'));
    await writeFile(path.join(modelDirectory, 'review.model3.json'), '{"Version":3}');
    await writeFile(path.join(modelDirectory, 'textures', 'review image.png'), 'review-texture');
    await writeFile(path.join(modelDirectory, 'private.txt'), 'not-a-model-asset');
    await writeFile(path.join(directory, 'models-other', 'private.json'), 'outside-root');
    for (const extension of ['wav', 'mp3', 'ogg']) {
      await writeFile(path.join(modelDirectory, 'motions', `review.${extension}`), `${extension}-motion-audio`);
    }
    await writeFile(path.join(directory, 'models-other', 'private.wav'), 'outside-audio');
    app = Fastify();
    sockets = new Set();
    app.server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    connections = 0;
    registerLocalAccess(app, token, 'http://127.0.0.1:5173');
    await app.register(websocket);
    app.get('/api/settings', () => ({ ok: true }));
    app.get('/ws', { websocket: true }, (socket) => {
      connections++;
      socket.send(JSON.stringify({ type: 'status', payload: { ok: true } }));
    });
    registerLocalFiles(app, undefined, () => path.join(modelDirectory, 'review.model3.json'));
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    origin = address;
    host = new URL(address).host;
  });

  afterEach(async () => {
    for (const socket of sockets ?? []) socket.destroy();
    await app?.close();
    if (directory && path.dirname(directory) === tmpdir() && path.basename(directory).startsWith('vtuber-security-test-')) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  function get(url: string, headers: Record<string, string> = {}) {
    return app.inject({ method: 'GET', url, headers: { host, origin, cookie, ...headers } });
  }

  async function websocketAttempt(headers: Record<string, string>) {
    const messages: unknown[] = [];
    let opened = false;
    return new Promise<{ status: number; opened: boolean; messages: unknown[] }>((resolve, reject) => {
      const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, { headers });
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket handshake timed out')); }, 2000);
      socket.on('error', () => { /* Rejected handshakes are asserted through unexpected-response. */ });
      socket.once('unexpected-response', (request, response) => {
        clearTimeout(timer);
        socket.once('close', () => resolve({ status: response.statusCode ?? 0, opened, messages }));
        response.destroy();
        request.destroy();
        socket.terminate();
      });
      socket.once('open', () => { opened = true; });
      socket.once('message', (raw) => {
        clearTimeout(timer);
        messages.push(JSON.parse(raw.toString()));
        socket.once('close', () => resolve({ status: 101, opened, messages }));
        socket.close();
      });
    });
  }

  it('requires the exact session cookie before returning API data', async () => {
    expect((await get('/api/settings', { cookie: '' })).statusCode).toBe(401);
    expect((await get('/api/settings', { cookie: `vtuber_session=${'b'.repeat(64)}` })).statusCode).toBe(401);
    expect((await get('/api/settings', { cookie: 'vtuber_session=malformed' })).statusCode).toBe(401);
    expect((await get('/api/settings', { cookie: `other=value; ${cookie}; ignored=value` })).json()).toEqual({ ok: true });
  });

  it('rejects untrusted, null and misleading origins and hosts even with a valid cookie', async () => {
    for (const badOrigin of ['https://review.invalid', 'null', `${origin}.review.invalid`]) {
      expect((await get('/api/settings', { origin: badOrigin })).statusCode).toBe(403);
    }
    for (const badHost of ['review.invalid', `localhost:${new URL(origin).port}`, `${host}.review.invalid`]) {
      expect((await get('/api/settings', { host: badHost })).statusCode).toBe(403);
    }
    expect((await get('/api/settings')).statusCode).toBe(200);
    expect((await get('/api/settings', { origin: 'http://127.0.0.1:5173' })).statusCode).toBe(200);
  });

  it('rejects unauthorized WebSocket upgrades before the route can send any events', async () => {
    const attempts: { headers: Record<string, string>; status: number }[] = [
      { headers: { host, origin }, status: 401 },
      { headers: { host, origin, cookie: `vtuber_session=${'b'.repeat(64)}` }, status: 401 },
      { headers: { host, origin: 'https://review.invalid', cookie }, status: 403 },
      { headers: { host: 'review.invalid', origin, cookie }, status: 403 },
    ];
    for (const { headers, status } of attempts) {
      const result = await websocketAttempt(headers);
      expect(result).toEqual({ status, opened: false, messages: [] });
    }
    expect(connections).toBe(0);
  });

  it('allows authenticated WebSocket clients from the application origin', async () => {
    const result = await websocketAttempt({ host, origin, cookie });
    expect(result).toEqual({ status: 101, opened: true, messages: [{ type: 'status', payload: { ok: true } }] });
    expect(connections).toBe(1);
  });

  it('serves the selected model and encoded texture filenames with private caching', async () => {
    const model = await get('/api/avatar/model/review.model3.json');
    expect(model.statusCode).toBe(200);
    expect(model.json()).toEqual({ Version: 3 });
    expect(model.headers['access-control-allow-origin']).toBeUndefined();
    expect(model.headers['cache-control']).toBe('no-store');
    expect(model.headers['x-content-type-options']).toBe('nosniff');
    const texture = await get('/api/avatar/model/textures/review%20image.png');
    expect(texture.statusCode).toBe(200);
    expect(texture.body).toBe('review-texture');
    expect((await get('/api/avatar/model/review.model3.json', { cookie: '' })).statusCode).toBe(401);
  });

  it('has no legacy arbitrary-directory asset route and denies non-model files', async () => {
    const encodedRoot = Buffer.from(directory).toString('base64url');
    expect((await get(`/api/avatar/asset/${encodedRoot}/models-other/private.json`)).statusCode).toBe(404);
    expect((await get('/api/avatar/model/private.txt')).statusCode).toBe(403);
    expect((await get('/api/avatar/model/missing.png')).statusCode).toBe(404);
  });

  it.each([
    ['wav', 'audio/wav'],
    ['mp3', 'audio/mpeg'],
    ['ogg', 'audio/ogg'],
  ])('serves Live2D motion sound .%s with the correct MIME and no cross-origin exposure', async (extension, mime) => {
    const response = await get(`/api/avatar/model/motions/review.${extension}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(`${extension}-motion-audio`);
    expect(response.headers['content-type']).toBe(mime);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await get(`/api/avatar/model/motions/review.${extension}`, { cookie: '' })).statusCode).toBe(401);
  });

  it('does not expose audio outside the selected model directory', async () => {
    const response = await get('/api/avatar/model/%2e%2e%2fmodels-other%2fprivate.wav');
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('outside-audio');
  });

  it('rejects encoded traversal into a sibling directory sharing the model-root prefix', async () => {
    const response = await get('/api/avatar/model/%2e%2e%2fmodels-other%2fprivate.json');
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('outside-root');
  });

  it('resolves directory links before deciding whether an asset belongs to the model root', async () => {
    await symlink(path.join(directory, 'models-other'), path.join(modelDirectory, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const response = await get('/api/avatar/model/escape/private.json');
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('outside-root');
  });
});
