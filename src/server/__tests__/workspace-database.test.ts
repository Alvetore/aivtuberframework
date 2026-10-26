import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../database';
import type { ChatMessage } from '../../shared/types';
import { defaultSettings } from '../../shared/types';
import { pickProfileSettings, type Operation } from '../../shared/product';

let directory: string;
let filename: string;
let open: AppDatabase | undefined;
function openWorkspace() { open = new AppDatabase(filename); return open; }
function reopenWorkspace() { open?.raw().close(); return openWorkspace(); }
function legacyFixture() {
  const db = new Database(filename);
  db.exec(`
    CREATE TABLE viewers (id INTEGER PRIMARY KEY,twitch_id TEXT NOT NULL UNIQUE,username TEXT NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,message_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE messages (id TEXT PRIMARY KEY,viewer_id INTEGER,username TEXT NOT NULL,message TEXT NOT NULL,timestamp TEXT NOT NULL,is_bot_response INTEGER NOT NULL DEFAULT 0,FOREIGN KEY (viewer_id) REFERENCES viewers(id) ON DELETE CASCADE);
    CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE sessions (id INTEGER PRIMARY KEY,start_time TEXT NOT NULL,end_time TEXT,message_count INTEGER NOT NULL DEFAULT 0);
    INSERT INTO viewers VALUES (7,'viewer-id','Исходный автор','2026-01-01','2026-01-02',1);
    INSERT INTO messages VALUES ('original-message',7,'Исходный автор','Старый текст — без изменений','2026-01-02T01:02:03Z',0);
    INSERT INTO messages VALUES ('original-reply',NULL,'bot','Исходный ответ','2026-01-02T01:02:04Z',1);
    INSERT INTO sessions VALUES (42,'2026-01-02T00:00:00Z','2026-01-02T02:00:00Z',1);
  `);
  const insert = db.prepare('INSERT INTO settings VALUES (?,?)');
  for (const [key, value] of Object.entries({ characterName: 'Старая ведущая', characterPrompt: 'Сохранённый характер', ttsEnabled: false, live2dModelPath: 'C:/models/original/model.model3.json', extraFutureSetting: { nested: [0, false, null] } })) insert.run(key, JSON.stringify(value));
  db.close();
}
function tagged(db: AppDatabase, id: string, profileId: string, source: 'twitch'|'test', sessionId: number|null) {
  const message: ChatMessage = { id, twitchId: 'viewer-new', username: `Автор ${id}`, message: `Текст ${id}`, timestamp: '2026-10-25T12:00:00Z', badges: [] };
  db.recordChat(message); db.tagMessage(id, { profileId, source, sessionId });
}

beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'vtuber-workspace-db-')); filename = join(directory, 'fixture.sqlite'); });
afterEach(() => {
  open?.raw().close(); open = undefined;
  for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
  rmdirSync(directory);
});

describe('workspace migration and profile persistence', () => {
  it('preserves original IDs, authors, settings and legacy sessions across repeated migration', () => {
    legacyFixture(); let db = openWorkspace();
    const inherited = db.activeProfileId();
    expect(db.listProfiles()).toHaveLength(1);
    expect(db.listProfiles()[0].settings.characterName).toBe('Старая ведущая');
    expect(db.getSettings().ttsEnabled).toBe(false);
    expect((db.getSettings() as unknown as Record<string, unknown>).extraFutureSetting).toEqual({ nested: [0, false, null] });
    const original = db.raw().prepare('SELECT * FROM messages ORDER BY id').all();
    expect(db.scopedContext(20, inherited, 'twitch', null).map(row => row.username)).toContain('Исходный автор');
    expect(db.sessions().items[0]).toMatchObject({ id: 42, legacy: true, messageCount: 1, totalTokens: null });
    db = reopenWorkspace(); db = reopenWorkspace();
    expect(db.activeProfileId()).toBe(inherited);
    expect(db.listProfiles()).toHaveLength(1);
    expect(db.raw().prepare('SELECT * FROM messages ORDER BY id').all()).toEqual(original);
    expect(db.raw().prepare('SELECT * FROM viewers WHERE id=7').get()).toMatchObject({ twitch_id: 'viewer-id', username: 'Исходный автор', message_count: 1 });
    expect((db.getSettings() as unknown as Record<string, unknown>).extraFutureSetting).toEqual({ nested: [0, false, null] });
  });
  it('keeps new, duplicate and imported contexts separate from legacy and other profiles', () => {
    legacyFixture(); const db = openWorkspace(); const inherited = db.activeProfileId();
    const fresh = db.createProfile('Новый');
    const duplicate = db.duplicateProfile(inherited);
    const imported = db.importProfile(db.exportProfile(inherited));
    tagged(db, 'original-live', inherited, 'twitch', 1);
    tagged(db, 'fresh-live', fresh.id, 'twitch', 2);
    tagged(db, 'fresh-test', fresh.id, 'test', null);
    tagged(db, 'fresh-other-test', fresh.id, 'test', 99);
    expect(db.scopedContext(20, inherited, 'twitch', 1).map(row => row.message)).toEqual(['Старый текст — без изменений', 'Исходный ответ', 'Текст original-live']);
    expect(db.scopedContext(20, fresh.id, 'twitch', 2).map(row => row.message)).toEqual(['Текст fresh-live']);
    expect(db.scopedContext(20, fresh.id, 'test', null).map(row => row.message)).toEqual(['Текст fresh-test']);
    expect(db.scopedContext(20, inherited, 'test', null)).toEqual([]);
    for (const profile of [duplicate, imported]) expect(db.scopedContext(20, profile.id, 'twitch', null)).toEqual([]);
    expect(db.raw().prepare('SELECT id FROM profiles WHERE legacy_context=1').all()).toEqual([{ id: inherited }]);
    expect(db.exportProfile(inherited)).not.toHaveProperty('legacy_context');
    expect(db.listProfiles()).toHaveLength(4);
  });
  it('restores original model binding and keeps local paths out of duplicate/imported profiles', () => {
    legacyFixture(); let db = openWorkspace(); const inherited = db.activeProfileId();
    const fresh = db.createProfile('Новый');
    const duplicate = db.duplicateProfile(inherited);
    const imported = db.importProfile(db.exportProfile(inherited));
    expect(db.exportProfile(inherited).settings).not.toHaveProperty('live2dModelPath');
    expect(db.selectProfile(fresh.id).live2dModelPath).toBe('');
    db.saveSettings({ live2dModelPath: 'C:/models/new/model.model3.json' });
    expect(db.selectProfile(inherited).live2dModelPath).toBe('C:/models/original/model.model3.json');
    expect(db.selectProfile(fresh.id).live2dModelPath).toBe('C:/models/new/model.model3.json');
    for (const profile of [duplicate, imported]) expect(db.selectProfile(profile.id).live2dModelPath).toBe('');
    db = reopenWorkspace();
    expect(db.selectProfile(inherited).live2dModelPath).toBe('C:/models/original/model.model3.json');
    expect(db.selectProfile(fresh.id).live2dModelPath).toBe('C:/models/new/model.model3.json');
  });
  it('validates complete imports before changing settings, profiles, bindings or active profile', () => {
    const db = openWorkspace(); const inherited = db.activeProfileId();
    db.saveSettings({ llmModel: 'keep-global-model', live2dModelPath: 'C:/keep/model.json' });
    const before = { profiles: db.listProfiles(), settings: db.getSettings(), workspace: db.raw().prepare('SELECT * FROM workspace_state ORDER BY key').all() };
    for (const file of [
      { version: 2, name: 'bad', settings: pickProfileSettings(defaultSettings) },
      { version: 1, name: 'bad', settings: { ...pickProfileSettings(defaultSettings), llmApiKey: 'unsafe' } },
      { version: 1, name: 'bad', settings: { ...pickProfileSettings(defaultSettings), live2dModelPath: 'C:/untrusted/model.json' } },
      { version: 1, name: 'bad', settings: { ...pickProfileSettings(defaultSettings), maxResponsesPerMinute: 0 } },
      { version: 1, name: 'bad', settings: {} },
    ]) expect(() => db.importProfile(file)).toThrow();
    expect(db.activeProfileId()).toBe(inherited);
    expect({ profiles: db.listProfiles(), settings: db.getSettings(), workspace: db.raw().prepare('SELECT * FROM workspace_state ORDER BY key').all() }).toEqual(before);
  });
  it('cancels interrupted work on restart while preserving actual usage and unknown historical metrics', () => {
    let db = openWorkspace(); const profileId = db.activeProfileId(); const sessionId = db.startSession(profileId);
    const operation: Operation = { id: 'interrupted', author: 'Автор', prompt: 'Вопрос', profileId, sessionId, source: 'twitch', stage: 'queued', outcome: 'pending', createdAt: '2026-10-25T12:00:00Z', llmMs: 120, attempts: 2, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
    db.saveOperation(operation);
    db = reopenWorkspace();
    expect(db.recentOperations()[0]).toMatchObject({ id: 'interrupted', outcome: 'cancelled', stage: 'finished', reason: 'server_restarted', llmMs: 120, attempts: 2, usage: { totalTokens: 15 } });
    expect(db.sessions().items[0]).toMatchObject({ id: sessionId, legacy: false, totalTokens: 15 });
    expect(db.sessions().items[0].endTime).not.toBeNull();
    db.saveOperation({ ...operation, id: 'unknown-usage', outcome: 'failed', usage: undefined });
    expect(db.sessions().items[0].totalTokens).toBeNull();
    db = reopenWorkspace();
    expect(db.recentOperations().find(op => op.id === 'interrupted')?.reason).toBe('server_restarted');
  });
});
