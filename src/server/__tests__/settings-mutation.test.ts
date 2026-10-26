import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { registerSettingsMutationGuard } from '../settings-mutation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('rejects a profile request parsed during a settings write while allowing emergency controls', async () => {
  const app = Fastify();
  let saving = false;
  let selectedProfile = 'first';
  let paused = false;
  const parsing = deferred<() => void>();
  const persisting = deferred<void>();
  const releaseSave = deferred<void>();
  registerSettingsMutationGuard(app, () => saving);
  app.addContentTypeParser('application/slow-json', { parseAs: 'string' }, (_request, _body, done) => {
    parsing.resolve(() => done(null, {}));
  });
  app.put('/api/settings', async () => {
    if (saving) throw Object.assign(new Error('Already saving'), { statusCode: 409 });
    saving = true;
    persisting.resolve();
    try { await releaseSave.promise; return { profile: selectedProfile }; }
    finally { saving = false; }
  });
  app.post('/api/profiles/second/select', () => { selectedProfile = 'second'; return {}; });
  app.post('/api/runtime/pause', () => { paused = true; return {}; });
  app.post('/api/runtime/start', () => ({}));
  app.get('/api/snapshot', () => ({ profile: selectedProfile }));
  try {
    // The selection reaches onRequest before saving starts, but its parser is delayed.
    const selection = app.inject({ method: 'POST', url: '/api/profiles/second/select', headers: { 'content-type': 'application/slow-json' }, payload: '{}' }).then(response => response);
    const finishParsing = await parsing.promise;
    const save = app.inject({ method: 'PUT', url: '/api/settings', payload: {} }).then(response => response);
    await persisting.promise;
    finishParsing();
    expect((await selection).statusCode).toBe(409);
    expect(selectedProfile).toBe('first');
    expect((await app.inject({ method: 'POST', url: '/api/runtime/start', payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/runtime/pause?source=ui', payload: {} })).statusCode).toBe(200);
    expect(paused).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/snapshot' })).statusCode).toBe(200);
    releaseSave.resolve();
    expect((await save).json()).toEqual({ profile: 'first' });
    expect((await app.inject({ method: 'POST', url: '/api/profiles/second/select', payload: {} })).statusCode).toBe(200);
    expect(selectedProfile).toBe('second');
  } finally { releaseSave.resolve(); await app.close(); }
});
