const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { app, safeStorage } = require('electron');
const keys = ['twitchOauthToken', 'llmApiKey', 'openaiTtsApiKey', 'elevenlabsApiKey'];
const file = path.join(app.getPath('userData'), 'secrets.bin');

function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid secret storage.');
  for (const key of keys) if (Object.hasOwn(data, key) && typeof data[key] !== 'string') throw new Error('Invalid secret value.');
  return data;
}
function read() {
  if (!fs.existsSync(file)) return {};
  const bytes = fs.readFileSync(file);
  // Compatibility read only: old plaintext storage is encrypted on initialization.
  if (bytes.toString('utf8').trimStart().startsWith('{')) return validate(JSON.parse(bytes.toString('utf8')));
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Protected secret storage is unavailable.');
  return validate(JSON.parse(safeStorage.decryptString(bytes)));
}
function write(data) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Protected secret storage is unavailable; secrets were not saved.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const bytes = safeStorage.encryptString(JSON.stringify(validate(data)));
    const handle = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
    const verified = JSON.parse(safeStorage.decryptString(fs.readFileSync(temporary)));
    if (JSON.stringify(verified) !== JSON.stringify(data)) throw new Error('Secret storage verification failed.');
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function all() {
  const data = read();
  return Object.fromEntries(keys.map(key => [key, data[key] ?? '']));
}
function update(changes, onlyMissing = false) {
  const data = read();
  for (const [key, value] of Object.entries(changes)) {
    if (!keys.includes(key) || typeof value !== 'string') throw new Error('Invalid secret update.');
    // An empty stored value is a tombstone: never resurrect it from legacy DB/env.
    if (!onlyMissing || !Object.hasOwn(data, key)) data[key] = value;
  }
  write(data);
  return all();
}
function initialize(environment) {
  const changes = Object.fromEntries(Object.entries(environment).filter(([, value]) => typeof value === 'string' && value));
  if (fs.existsSync(file) || Object.keys(changes).length) update(changes, true);
  return all();
}
module.exports = { all, update, initialize, file };
