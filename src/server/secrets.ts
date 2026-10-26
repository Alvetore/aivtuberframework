import { randomUUID } from 'node:crypto';
import { secretKeys, secretEnvironment, type SecretKey, type SecretValues } from '../shared/secrets.js';

export type PersistSecrets = (changes: Partial<SecretValues>, onlyMissing?: boolean) => Promise<SecretValues>;

// Main owns durable storage. The server only retains active values.
export class Secrets {
  private values: SecretValues;
  constructor(private persist: PersistSecrets, env = process.env) {
    this.values = Object.fromEntries(secretKeys.map(key => [key, env[secretEnvironment[key]] ?? ''])) as SecretValues;
  }
  get(key: SecretKey) { return this.values[key]; }
  effective<T extends object>(settings: T): T & SecretValues { return { ...settings, ...this.values }; }
  publicSettings<T extends object>(settings: T): T & SecretValues {
    return { ...settings, ...Object.fromEntries(secretKeys.map(key => [key, this.get(key) ? '***' : ''])) } as T & SecretValues;
  }
  async update(changes: Partial<SecretValues>, onlyMissing = false) {
    if (Object.keys(changes).length) this.values = await this.persist(changes, onlyMissing);
  }
}

export const persistInElectron: PersistSecrets = (changes, onlyMissing = false) => new Promise((resolve, reject) => {
  if (!process.send || !process.connected) return reject(new Error('Protected secret storage requires Electron.'));
  const requestId = randomUUID();
  const finish = (error?: Error, values?: SecretValues) => {
    clearTimeout(timer); process.off('message', onMessage); process.off('disconnect', onDisconnect);
    if (error) reject(error); else resolve(values!);
  };
  const onDisconnect = () => finish(new Error('Secret storage disconnected.'));
  const onMessage = (raw: unknown) => {
    const msg = raw as { type?: string; requestId?: string; error?: string; values?: SecretValues };
    if (msg?.type !== 'secrets:result' || msg.requestId !== requestId) return;
    if (msg.error || !msg.values || !secretKeys.every(key => typeof msg.values![key] === 'string')) {
      finish(new Error(msg.error || 'Invalid secret storage response.'));
    } else finish(undefined, msg.values);
  };
  const timer = setTimeout(() => finish(new Error('Secret storage timeout.')), 10_000);
  process.on('message', onMessage); process.once('disconnect', onDisconnect);
  process.send({ type: 'secrets:write', requestId, changes, onlyMissing }, error => { if (error) finish(error); });
});
