import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerProfileRoutes } from '../profiles';
import type { AppDatabase } from '../database';
import { defaultSettings } from '../../shared/types';
import { pickProfileSettings, type Profile, type RuntimeState } from '../../shared/product';

const first: Profile = { id: 'first', name: 'Первый', createdAt: '2026-10-25T00:00:00Z', settings: pickProfileSettings(defaultSettings) };
const second: Profile = { ...first, id: 'second', name: 'Второй' };
const instances: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(instances.splice(0).map(app => app.close())); });
function setup(state: RuntimeState['state'] = 'stopped') {
  const app = Fastify(); instances.push(app);
  let active = 'first';
  const db = {
    listProfiles: vi.fn(() => [first, second]),
    createProfile: vi.fn(() => first), importProfile: vi.fn(() => first), updateProfile: vi.fn(() => first), duplicateProfile: vi.fn(() => second),
    activeProfileId: () => active,
    selectProfile: vi.fn((id: string) => { active = id; return defaultSettings; }),
    getSettings: () => defaultSettings,
    exportProfile: vi.fn(() => ({ version: 1, name: first.name, settings: first.settings })),
  };
  const context = { getRuntime: () => ({ state, muted: false, sessionId: null, profileId: active, cooldownUntil: 0 }), beforeSelect: vi.fn(), applySettings: vi.fn(), publish: vi.fn() };
  registerProfileRoutes(app, db as unknown as AppDatabase, context);
  return { app, db, context };
}

describe('profile API trust boundary', () => {
  it('rejects secret-bearing and unsupported imports before any write', async () => {
    const { app, db, context } = setup();
    for (const payload of [
      { version: 2, name: 'Новый', settings: first.settings },
      { version: 1, name: 'Новый', settings: { ...first.settings, llmApiKey: 'never-store-me' } },
      { version: 1, name: 'Новый', settings: { ...first.settings, live2dModelPath: 'C:/private/model.json' } },
      { version: 1, name: 'Новый', settings: first.settings, inheritsLegacy: true },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/profiles/import', payload });
      expect(response.statusCode).toBe(400);
    }
    expect(db.importProfile).not.toHaveBeenCalled();
    expect(context.publish).not.toHaveBeenCalled();
  });
  it('rejects profile changes while running without cancelling the current operation', async () => {
    const { app, db, context } = setup('running');
    const response = await app.inject({ method: 'POST', url: '/api/profiles/second/select', payload: {} });
    expect(response.statusCode).toBe(409);
    expect(db.selectProfile).not.toHaveBeenCalled();
    expect(context.beforeSelect).not.toHaveBeenCalled();
  });
  it('selects on pause exactly once and rejects unknown IDs without cancellation', async () => {
    const { app, db, context } = setup('paused');
    expect((await app.inject({ method: 'POST', url: '/api/profiles/missing/select', payload: {} })).statusCode).toBe(404);
    expect(context.beforeSelect).not.toHaveBeenCalled();
    for (let attempt = 0; attempt < 2; attempt++) expect((await app.inject({ method: 'POST', url: '/api/profiles/second/select', payload: {} })).statusCode).toBe(200);
    expect(db.selectProfile).toHaveBeenCalledTimes(1);
    expect(context.beforeSelect).toHaveBeenCalledTimes(1);
    expect(context.applySettings).toHaveBeenCalledWith(defaultSettings);
  });
  it('exports only the strict portable schema', async () => {
    const { app, db } = setup();
    const response = await app.inject({ method: 'GET', url: '/api/profiles/first/export' });
    expect(response.statusCode).toBe(200);
    const exported = response.json();
    expect(exported.settings).not.toHaveProperty('llmApiKey');
    expect(exported.settings).not.toHaveProperty('ttsOutputDevice');
    expect(exported.settings).not.toHaveProperty('live2dModelPath');
    db.exportProfile.mockReturnValueOnce({ version: 1, name: 'unsafe', settings: { ...first.settings, llmApiKey: 'leak' } } as never);
    const unsafe = await app.inject({ method: 'GET', url: '/api/profiles/first/export' });
    expect(unsafe.statusCode).toBe(500);
    expect(unsafe.body).not.toContain('leak');
  });
});
