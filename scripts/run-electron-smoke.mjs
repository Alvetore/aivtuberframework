import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const development = process.argv.includes('--dev');
const packaged = process.argv.includes('--packaged');
const visual=process.argv.includes('--visual');
if (development && packaged) throw new Error('Choose either --dev or --packaged.');
const profile = mkdtempSync(path.join(tmpdir(), 'vtuber-electron-smoke-'));
let buildDirectory;
let vite;
const nativeFile = path.join(root, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node');
const nativeMetadata = path.join(path.dirname(nativeFile), '.forge-meta');
let originalNative;
let nativeNeedsRestore = false;

function restoreNative() {
  // Builder may hard-link native modules into the package. Replace the workspace
  // inode instead of overwriting it, which would also corrupt the packaged ABI.
  const temporary = `${nativeFile}.${process.pid}.restore`;
  try {
    writeFileSync(temporary, originalNative); renameSync(temporary, nativeFile); nativeNeedsRestore = false;
    // An Electron rebuild marker must not describe the restored Node binary.
    if (existsSync(nativeMetadata)) unlinkSync(nativeMetadata);
  }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

async function run(executable, args, env, timeout = 45_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data;if(visual)process.stdout.write(data); });
    child.stderr.on('data', data => { output += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Smoke child timed out.')); }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

function seedLegacyDatabase() {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(profile, 'vtuber.sqlite'));
  try {
    db.exec(readFileSync(path.join(root, 'drizzle/0000_lethal_jane_foster.sql'), 'utf8'));
    const insert = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)');
    for (const key of ['twitchOauthToken', 'llmApiKey', 'openaiTtsApiKey', 'elevenlabsApiKey']) insert.run(key, JSON.stringify(`legacy-smoke-${key}`));
    insert.run('unknown_setting', JSON.stringify({ preserved: [0, false, null] }));
    insert.run('ttsEnabled', 'false');
    db.prepare('INSERT INTO messages (id,username,message,timestamp) VALUES (?,?,?,?)').run('smoke-history', 'Review', 'history sentinel', '2026-10-25T00:00:00.000Z');
  } finally { db.close(); }
}

function verifyPreservation() {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(profile, 'vtuber.sqlite'), { readonly: true });
  try {
    if (db.prepare('SELECT message FROM messages WHERE id=?').get('smoke-history')?.message !== 'history sentinel') throw new Error('History was not preserved.');
    if (db.prepare('SELECT value FROM settings WHERE key=?').get('unknown_setting')?.value !== JSON.stringify({ preserved: [0, false, null] })) throw new Error('Unknown settings were not preserved.');
    for (const key of ['twitchOauthToken', 'llmApiKey', 'openaiTtsApiKey', 'elevenlabsApiKey']) {
      if (db.prepare('SELECT value FROM settings WHERE key=?').get(key)) throw new Error('Plaintext secret remained in SQLite.');
    }
    const ciphertext = readFileSync(path.join(profile, 'secrets.bin'));
    if (ciphertext.includes(Buffer.from('vtuber-smoke-fake')) || ciphertext.includes(Buffer.from('legacy-smoke-'))) throw new Error('Vault is not encrypted.');
    if (readFileSync(path.join(profile, 'vtuber.sqlite')).includes(Buffer.from('legacy-smoke-'))) throw new Error('Deleted secret bytes remained in SQLite.');
  } finally { db.close(); }
}

try {
  let executable = require('electron');
  let args = [path.join(root, 'scripts/electron-smoke.cjs')];
  if (packaged) {
    buildDirectory = mkdtempSync(path.join(tmpdir(), 'vtuber-packaged-smoke-build-'));
    const config = { ...JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).build };
    config.files = [...config.files, 'scripts/electron-smoke.cjs'];
    config.extraMetadata = { main: 'scripts/electron-smoke.cjs' };
    config.directories = { ...config.directories, output: path.join(buildDirectory, 'output') };
    config.win = { ...config.win, signAndEditExecutable: false };
    const configFile = path.join(buildDirectory, 'builder.json');
    writeFileSync(configFile, JSON.stringify(config));
    // Packaging rebuilds this file for Electron. Preserve the workspace Node ABI.
    originalNative = readFileSync(nativeFile);
    nativeNeedsRestore = true;
    if (existsSync(nativeMetadata)) unlinkSync(nativeMetadata);
    const result = await run(process.execPath, [require.resolve('electron-builder/cli.js'), '--dir', '--win', '--x64', '--config', configFile], { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, 240_000);
    restoreNative();
    if (result.code !== 0) throw new Error(`Packaging failed: ${result.output.slice(-5000)}`);
    executable = path.join(buildDirectory, 'output/win-unpacked/AI VTuber Framework Lite.exe');
    args = [];
    console.log('Packaged executable built.');
  } else if (development) {
    const { createServer } = await import('vite');
    vite = await createServer({ configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 5173, strictPort: true } });
    await vite.listen();
    args.push('--dev');
  }
  seedLegacyDatabase();
  for (const phase of ['save', 'clear', 'verify']) {
    const env = { ...process.env, VTUBER_SMOKE_DIR: profile, VTUBER_SMOKE_PHASE: phase, VTUBER_SMOKE_VISUAL: visual&&phase==='save'?'1':'0', LOG_LEVEL: 'error' };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await run(executable, args, env,visual&&phase==='save'?190_000:70_000);
    const summaries = result.output.split(/\r?\n/).filter(line => line.startsWith('{"smoke"'));
    console.log(summaries.join('\n'));
    if (result.code !== 0 || !summaries.some(line => line.includes('"ok":true')) || !summaries.some(line => line.includes('"shutdown":"clean"'))) throw new Error(`Electron ${phase} failed: ${result.output.slice(-5000)}`);
    verifyPreservation();
  }
  console.log(JSON.stringify({ smoke: packaged ? 'packaged' : development ? 'development' : 'built', ok: true, legacyMigration: true, historyPreserved: true, secretBytesRemoved: true }));
} finally {
  if (nativeNeedsRestore) restoreNative();
  await vite?.close();
  for (const directory of [profile, buildDirectory].filter(Boolean)) {
    if (path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith('vtuber-')) throw new Error('Unexpected smoke cleanup path.');
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
