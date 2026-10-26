import { afterEach, describe, expect, it, vi } from 'vitest';
import { Secrets } from '../secrets.js';
import { AppDatabase } from '../database.js';
import { secretEnvironment, secretKeys, type SecretValues } from '../../shared/secrets.js';

const values: SecretValues = {
  twitchOauthToken: 'oauth:review-twitch-secret', llmApiKey: 'review-llm-secret',
  openaiTtsApiKey: 'review-tts-secret', elevenlabsApiKey: 'review-eleven-secret',
};
const environment = Object.fromEntries(secretKeys.map(key => [secretEnvironment[key], values[key]]));

describe('active server secrets', () => {
  it('masks all four keys in public settings, overriding old raw fields', () => {
    const secrets = new Secrets(vi.fn(), environment);
    const exposed = secrets.publicSettings({ characterName: 'Review', ...values });
    expect(exposed.characterName).toBe('Review');
    for (const key of secretKeys) {
      expect(exposed[key]).toBe('***');
      expect(JSON.stringify(exposed)).not.toContain(values[key]);
    }
    expect(secrets.effective({ characterName: 'Review' })).toEqual({ characterName: 'Review', ...values });
  });

  it('clears each environment-backed key immediately after durable acknowledgement', async () => {
    let durable = { ...values };
    const persist = vi.fn(async (changes) => { durable = { ...durable, ...changes }; return { ...durable }; });
    const secrets = new Secrets(persist, environment);
    for (const key of secretKeys) {
      await secrets.update({ [key]: '' });
      expect(secrets.get(key)).toBe('');
      expect(secrets.publicSettings({})[key]).toBe('');
      expect(secrets.effective({})[key]).toBe('');
    }
    expect(persist).toHaveBeenCalledTimes(4);
  });

  it('keeps active values unchanged when durable storage rejects a write', async () => {
    const persist = vi.fn(async () => { throw new Error('storage verification failed'); });
    const secrets = new Secrets(persist, environment);
    await expect(secrets.update({ llmApiKey: '' })).rejects.toThrow('storage verification failed');
    expect(secrets.effective({})).toEqual(values);
  });

  it('passes migration onlyMissing through and skips empty updates', async () => {
    const persist = vi.fn(async () => ({ ...values }));
    const secrets = new Secrets(persist, {});
    await secrets.update({});
    expect(persist).not.toHaveBeenCalled();
    await secrets.update({ llmApiKey: 'old-value' }, true);
    expect(persist).toHaveBeenCalledWith({ llmApiKey: 'old-value' }, true);
    expect(secrets.get('llmApiKey')).toBe(values.llmApiKey);
  });
});

describe('legacy SQLite secret migration', () => {
  let db: AppDatabase | undefined;
  afterEach(() => { db?.raw().close(); db = undefined; });
  function fixture() {
    db = new AppDatabase(':memory:');
    const insert = db.raw().prepare('INSERT INTO settings (key,value) VALUES (?,?)');
    for (const key of secretKeys) insert.run(key, JSON.stringify(values[key]));
    insert.run('characterName', JSON.stringify('Preserved'));
    insert.run('unknown_setting', JSON.stringify({ nested: [0, false, null] }));
    db.recordChat({ id: 'preserve-chat', twitchId: 'viewer', username: 'Alice', message: 'preserve message', timestamp: '2026-10-25T00:00:00.000Z', badges: [] });
    db.recordBotResponse('preserve response');
    db.startSession();
    return db;
  }
  function snapshot(current: AppDatabase) {
    return Object.fromEntries(['viewers', 'messages', 'sessions'].map(table => [table, current.raw().prepare(`SELECT * FROM ${table}`).all()]));
  }
  function savedSecrets(current: AppDatabase) {
    return current.raw().prepare('SELECT key,value FROM settings ORDER BY key').all();
  }

  it('deletes legacy keys only after durable confirmation and preserves unrelated data', async () => {
    const current = fixture();
    const before = snapshot(current);
    let confirm!: () => void;
    const persist = vi.fn(async (incoming) => {
      expect(incoming).toEqual(values);
      expect(savedSecrets(current)).toHaveLength(6);
      await new Promise<void>(resolve => { confirm = resolve; });
    });
    const migration = current.migrateSecrets(persist);
    expect(savedSecrets(current)).toHaveLength(6);
    confirm();
    await migration;
    expect(savedSecrets(current)).toEqual([
      { key: 'characterName', value: JSON.stringify('Preserved') },
      { key: 'unknown_setting', value: JSON.stringify({ nested: [0, false, null] }) },
    ]);
    expect(snapshot(current)).toEqual(before);
    await current.migrateSecrets(persist);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('retains original keys and all history when storage fails, then permits retry', async () => {
    const current = fixture();
    const before = snapshot(current), rows = savedSecrets(current);
    await expect(current.migrateSecrets(async () => { throw new Error('encryption unavailable'); })).rejects.toThrow('encryption unavailable');
    expect(savedSecrets(current)).toEqual(rows);
    expect(snapshot(current)).toEqual(before);
    const persist = vi.fn(async () => {});
    await current.migrateSecrets(persist);
    expect(persist).toHaveBeenCalledWith(values);
    expect(snapshot(current)).toEqual(before);
  });

  it('does not delete anything when legacy secret data is malformed', async () => {
    const current = fixture();
    current.raw().prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(42), 'openaiTtsApiKey');
    const before = savedSecrets(current);
    const persist = vi.fn(async () => {});
    await expect(current.migrateSecrets(persist)).rejects.toThrow('Invalid legacy secret');
    expect(persist).not.toHaveBeenCalled();
    expect(savedSecrets(current)).toEqual(before);
  });

  it('rejects new plaintext secret settings writes without partially saving other changes', () => {
    const current = fixture();
    const before = savedSecrets(current);
    for (const key of secretKeys) {
      expect(() => current.saveSettings({ characterName: 'must not save', [key]: 'raw-new-key' })).toThrow('Secrets cannot be saved as settings');
    }
    expect(savedSecrets(current)).toEqual(before);
  });
});
