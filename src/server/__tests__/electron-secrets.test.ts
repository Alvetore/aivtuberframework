import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../../electron/secrets.cjs', import.meta.url), 'utf8');
const roots: string[] = [];
const keys = ['twitchOauthToken', 'llmApiKey', 'openaiTtsApiKey', 'elevenlabsApiKey'];

function vault(options: { available?: boolean; corruptVerification?: boolean; renameFailure?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'vtuber-vault-test-'));
  roots.push(root);
  const file = path.join(root, 'secrets.bin');
  const safeStorage = {
    isEncryptionAvailable: vi.fn(() => options.available !== false),
    encryptString: vi.fn((text: string) => Buffer.from('ENCRYPTED:' + Buffer.from(text).toString('base64'))),
    decryptString: vi.fn((bytes: Buffer) => {
      const text = bytes.toString();
      if (!text.startsWith('ENCRYPTED:')) throw new Error('corrupt ciphertext');
      if (options.corruptVerification) return '{}';
      return Buffer.from(text.slice('ENCRYPTED:'.length), 'base64').toString();
    }),
  };
  const fsProxy = {
    ...fs,
    renameSync: vi.fn((from: string, to: string) => {
      if (options.renameFailure) throw new Error('rename failed');
      fs.renameSync(from, to);
    }),
    fsyncSync: vi.fn(fs.fsyncSync),
  };
  const module = { exports: {} as any };
  vm.runInNewContext(source, {
    module, Buffer,
    require: (name: string) => name === 'electron' ? { app: { getPath: () => root }, safeStorage }
      : name === 'node:fs' ? fsProxy : require(name),
  }, { filename: 'secrets.cjs' });
  return { root, file, api: module.exports, safeStorage, fsProxy, options };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('vtuber-vault-test-')) throw new Error('Unexpected test cleanup path');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Electron protected vault', () => {
  it('encrypts all four secrets, fsyncs and verifies a temporary file before atomic replacement', () => {
    const v = vault();
    const values = Object.fromEntries(keys.map(key => [key, `private-${key}`]));
    expect(v.api.update(values)).toEqual(values);
    const bytes = fs.readFileSync(v.file, 'utf8');
    for (const value of Object.values(values)) expect(bytes).not.toContain(value);
    expect(v.fsProxy.fsyncSync).toHaveBeenCalledTimes(1);
    expect(v.fsProxy.renameSync).toHaveBeenCalledTimes(1);
    const [temporary, destination] = v.fsProxy.renameSync.mock.calls[0];
    expect(temporary).toMatch(/secrets\.bin\..+\.tmp$/);
    expect(destination).toBe(v.file);
    expect(fs.readdirSync(v.root)).toEqual(['secrets.bin']);
    expect(v.api.all()).toEqual(values);
  });

  it('refuses plaintext fallback when encryption is unavailable', () => {
    const v = vault({ available: false });
    expect(() => v.api.update({ llmApiKey: 'must-not-write' })).toThrow('Protected secret storage is unavailable');
    expect(fs.existsSync(v.file)).toBe(false);
    expect(fs.readdirSync(v.root)).toEqual([]);
  });

  it('preserves an existing vault and cleans temporary files after failed verification', () => {
    const v = vault();
    v.api.update({ llmApiKey: 'old' });
    const original = fs.readFileSync(v.file);
    v.options.corruptVerification = true;
    expect(() => v.api.update({ llmApiKey: 'new' })).toThrow('verification failed');
    expect(fs.readFileSync(v.file)).toEqual(original);
    expect(fs.readdirSync(v.root)).toEqual(['secrets.bin']);
  });

  it('preserves an existing vault and cleans temporary files when atomic rename fails', () => {
    const v = vault();
    v.api.update({ llmApiKey: 'old' });
    const original = fs.readFileSync(v.file);
    v.options.renameFailure = true;
    expect(() => v.api.update({ llmApiKey: 'new' })).toThrow('rename failed');
    expect(fs.readFileSync(v.file)).toEqual(original);
    expect(fs.readdirSync(v.root)).toEqual(['secrets.bin']);
  });

  it('surfaces corrupt storage instead of replacing it with an empty vault', () => {
    const v = vault();
    fs.writeFileSync(v.file, 'broken ciphertext');
    expect(() => v.api.all()).toThrow('corrupt ciphertext');
    expect(() => v.api.update({ llmApiKey: 'replacement' })).toThrow('corrupt ciphertext');
    expect(fs.readFileSync(v.file, 'utf8')).toBe('broken ciphertext');
  });

  it('encrypts legacy plaintext on initialization and retains its values', () => {
    const v = vault();
    fs.writeFileSync(v.file, JSON.stringify({ llmApiKey: 'legacy-key', twitchOauthToken: 'legacy-oauth' }));
    const result = v.api.initialize({ llmApiKey: 'env-must-not-overwrite', openaiTtsApiKey: 'env-tts' });
    expect(result).toEqual({ llmApiKey: 'legacy-key', twitchOauthToken: 'legacy-oauth', openaiTtsApiKey: 'env-tts', elevenlabsApiKey: '' });
    expect(fs.readFileSync(v.file, 'utf8')).toMatch(/^ENCRYPTED:/);
    expect(v.api.all()).toEqual(result);
  });

  it('keeps legacy plaintext intact and raises an error if encryption cannot initialize', () => {
    const v = vault({ available: false });
    const original = JSON.stringify({ llmApiKey: 'legacy-key' });
    fs.writeFileSync(v.file, original);
    expect(() => v.api.initialize({})).toThrow('Protected secret storage is unavailable');
    expect(fs.readFileSync(v.file, 'utf8')).toBe(original);
  });

  it('never resurrects cleared tombstones from legacy SQLite or environment imports', () => {
    const v = vault();
    v.api.update({ llmApiKey: '', twitchOauthToken: 'existing' });
    v.api.update({ llmApiKey: 'old-db-key', twitchOauthToken: 'old-db-token', openaiTtsApiKey: 'db-tts' }, true);
    expect(v.api.initialize({ llmApiKey: 'old-env-key' })).toEqual({ llmApiKey: '', twitchOauthToken: 'existing', openaiTtsApiKey: 'db-tts', elevenlabsApiKey: '' });
  });

  it('rejects unknown keys and non-string values without touching the original vault', () => {
    const v = vault();
    v.api.update({ llmApiKey: 'original' });
    const original = fs.readFileSync(v.file);
    expect(() => v.api.update({ unknown: 'value' })).toThrow('Invalid secret update');
    expect(() => v.api.update({ llmApiKey: null })).toThrow('Invalid secret update');
    expect(fs.readFileSync(v.file)).toEqual(original);
  });
});
