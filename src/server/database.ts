import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ChatMessage, Settings } from '../shared/types.js';
import { defaultSettings } from '../shared/types.js';
import * as schema from './schema.js';
import { secretKeys, type SecretValues } from '../shared/secrets.js';
import { ProfileFileSchema, pickProfileSettings, type Profile, type ProfileSettings, type ProfileFile, type Operation, type FeedMessage, type SessionSummary, type SessionDetail, type PageResult } from '../shared/product.js';

export interface ContextOptions { excludeBot?: boolean }

export interface ChatRecord {
  username: string;
  message: string;
  timestamp: string;
  isBotResponse: boolean;
}

export class AppDatabase {
  private db: Database.Database;
  private ormDb: BetterSQLite3Database<typeof schema>;

  constructor(customPath?: string) {
    let resolvedPath = customPath;
    if (!resolvedPath) {
      const userData = process.env.ELECTRON_USER_DATA;
      if (userData && userData.trim()) {
        resolvedPath = join(userData, 'vtuber.sqlite');
      } else {
        resolvedPath = 'data/vtuber.sqlite';
      }
    }
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('secure_delete = ON');
    this.migrate();
    this.migrateWorkspace();
    this.ormDb = drizzle(this.db, { schema });
  }
  private migrateWorkspace() {
    this.db.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY,name TEXT NOT NULL,settings TEXT NOT NULL,created_at TEXT NOT NULL,legacy_context INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS workspace_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS message_context (message_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,session_id INTEGER,source TEXT NOT NULL,reply_to_id TEXT,operation_id TEXT);
        CREATE INDEX IF NOT EXISTS idx_message_context_profile ON message_context(profile_id,source);
        CREATE INDEX IF NOT EXISTS idx_message_context_session ON message_context(session_id);
        CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,session_id INTEGER,source TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_operations_session ON operations(session_id,created_at);
        CREATE INDEX IF NOT EXISTS idx_operations_profile ON operations(profile_id,created_at);`);
      const columns = this.db.prepare('PRAGMA table_info(sessions)').all() as {name:string}[];
      if (!columns.some(c => c.name === 'profile_id')) this.db.exec('ALTER TABLE sessions ADD COLUMN profile_id TEXT');
      if (!columns.some(c => c.name === 'legacy')) this.db.exec('ALTER TABLE sessions ADD COLUMN legacy INTEGER NOT NULL DEFAULT 1');
      if (!(this.db.prepare('SELECT id FROM profiles LIMIT 1').get())) {
        const profile = this.createProfile(this.getSettings().characterName);
        this.db.prepare('UPDATE profiles SET legacy_context=1 WHERE id=?').run(profile.id);
        this.db.prepare('INSERT OR REPLACE INTO workspace_state VALUES (?,?)').run('active_profile', profile.id);
        this.db.prepare('INSERT OR REPLACE INTO workspace_state VALUES (?,?)').run(`model:${profile.id}`,this.getSettings().live2dModelPath??'');
      }
    })();
    // An interrupted process cannot leave a running session or pending operation.
    this.db.prepare('UPDATE sessions SET end_time=? WHERE legacy=0 AND end_time IS NULL').run(new Date().toISOString());
    const pending = this.db.prepare('SELECT data FROM operations').all() as {data:string}[];
    for (const row of pending) {
      const op = JSON.parse(row.data) as Operation;
      if (op.outcome === 'pending') this.saveOperation({...op,stage:'finished',outcome:'cancelled',reason:'server_restarted',finishedAt:new Date().toISOString()});
    }
  }
  listProfiles(): Profile[] {
    return (this.db.prepare('SELECT * FROM profiles ORDER BY created_at,id').all() as {id:string;name:string;settings:string;created_at:string}[])
      .map(r => ({id:r.id,name:r.name,settings:JSON.parse(r.settings),createdAt:r.created_at}));
  }
  activeProfileId(): string { return (this.db.prepare('SELECT value FROM workspace_state WHERE key=?').get('active_profile') as {value:string}).value; }
  createProfile(name: string, values?: ProfileSettings): Profile {
    const parsed = ProfileFileSchema.parse({version:1,name,settings:values ?? pickProfileSettings(this.getSettings())});
    const profile = {id:crypto.randomUUID(),name:parsed.name,settings:parsed.settings as ProfileSettings,createdAt:new Date().toISOString()};
    this.db.prepare('INSERT INTO profiles (id,name,settings,created_at) VALUES (?,?,?,?)').run(profile.id,profile.name,JSON.stringify(profile.settings),profile.createdAt);
    return profile;
  }
  updateProfile(id:string,name:string): Profile {
    const profile = this.requireProfile(id);
    const parsed = ProfileFileSchema.parse({version:1,name,settings:profile.settings});
    this.db.prepare('UPDATE profiles SET name=? WHERE id=?').run(parsed.name,id);
    return {...profile,name:parsed.name};
  }
  private requireProfile(id:string): Profile { const profile=this.listProfiles().find(p=>p.id===id); if(!profile) throw new Error('Профиль не найден.'); return profile; }
  duplicateProfile(id:string,name?:string): Profile { const p=this.requireProfile(id); return this.createProfile(name ?? `${p.name.slice(0,55)} — копия`,p.settings); }
  exportProfile(id:string): ProfileFile { const p=this.requireProfile(id); return ProfileFileSchema.parse({version:1,name:p.name,settings:p.settings}); }
  importProfile(input:unknown): Profile { const p=ProfileFileSchema.parse(input); return this.createProfile(p.name,p.settings as ProfileSettings); }
  selectProfile(id:string): Settings {
    const profile=this.requireProfile(id);
    return this.db.transaction(()=>{
      this.db.prepare('UPDATE workspace_state SET value=? WHERE key=?').run(id,'active_profile');
      // A model path is local and must be bound explicitly for every profile.
      const model = this.db.prepare('SELECT value FROM workspace_state WHERE key=?').get(`model:${id}`) as {value:string}|undefined;
      return this.saveSettings({...profile.settings,live2dModelPath:model?.value ?? ''});
    })();
  }
  saveOperation(operation:Operation): void { this.db.prepare('INSERT INTO operations VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(operation.id,operation.profileId,operation.sessionId,operation.source,operation.createdAt,JSON.stringify(operation)); }
  recentOperations(limit=100): Operation[] { return (this.db.prepare('SELECT data FROM operations ORDER BY created_at DESC,rowid DESC LIMIT ?').all(limit) as {data:string}[]).map(r=>JSON.parse(r.data)); }
  getOperation(id:string):Operation|undefined {const row=this.db.prepare('SELECT data FROM operations WHERE id=?').get(id) as {data:string}|undefined;return row?JSON.parse(row.data):undefined;}
  pendingOperations():Operation[] {return (this.db.prepare("SELECT data FROM operations WHERE json_extract(data,'$.outcome')='pending'").all() as {data:string}[]).map(r=>JSON.parse(r.data));}
  profileOperations(profileId:string,limit=100,pinnedIds:(string|undefined)[]=[]):Operation[] {
    const recent=(this.db.prepare('SELECT data FROM operations WHERE profile_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?').all(profileId,limit) as {data:string}[]).map(r=>JSON.parse(r.data) as Operation);
    const pinned=pinnedIds.flatMap(id=>{const op=id?this.getOperation(id):undefined;return op?.profileId===profileId?[op]:[];});
    const unique=new Map([...pinned,...recent].map(op=>[op.id,op]));
    return [...unique.values()].slice(0,limit).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  }
  profileFeed(profileId:string,limit=100):FeedMessage[]{
    const legacy=Boolean((this.db.prepare('SELECT legacy_context FROM profiles WHERE id=?').get(profileId) as {legacy_context:number})?.legacy_context);
    const rows=this.db.prepare(`SELECT m.id FROM messages m LEFT JOIN message_context c ON c.message_id=m.id WHERE c.profile_id=? OR (? AND c.message_id IS NULL) ORDER BY m.timestamp DESC,m.rowid DESC LIMIT ?`).all(profileId,Number(legacy),limit) as {id:string}[];
    const ids=new Set(rows.map(r=>r.id));
    // Fetch only selected IDs; history size never bounds the visible current-profile window.
    if(!ids.size)return [];
    return this.feedByIds([...ids]);
  }
  private feedByIds(ids:string[]):FeedMessage[]{
    const rows=this.db.prepare(`SELECT m.*,c.profile_id,c.session_id,c.source,c.reply_to_id,c.operation_id FROM messages m LEFT JOIN message_context c ON c.message_id=m.id WHERE m.id IN (${ids.map(()=>'?').join(',')}) ORDER BY m.timestamp,m.rowid`).all(...ids) as any[];
    return rows.map(r=>({id:r.id,username:r.username,message:r.message,timestamp:r.timestamp,isBotResponse:Boolean(r.is_bot_response),profileId:r.profile_id??undefined,sessionId:r.session_id,source:r.source??'legacy',replyToId:r.reply_to_id??undefined,operationId:r.operation_id??undefined}));
  }
  tagMessage(id:string,meta:{profileId:string;sessionId:number|null;source:'twitch'|'test';replyToId?:string;operationId?:string}): void {
    this.db.prepare('INSERT OR REPLACE INTO message_context VALUES (?,?,?,?,?,?)').run(id,meta.profileId,meta.sessionId,meta.source,meta.replyToId??null,meta.operationId??null);
  }
  scopedContext(limit:number,profileId:string,source:'twitch'|'test',sessionId:number|null): ChatRecord[] {
    const legacy = source==='twitch' && Boolean((this.db.prepare('SELECT legacy_context FROM profiles WHERE id=?').get(profileId) as {legacy_context:number})?.legacy_context);
    const rows=this.db.prepare(`SELECT m.username,m.message,m.timestamp,m.is_bot_response AS isBotResponse FROM messages m LEFT JOIN message_context c ON c.message_id=m.id
      WHERE (c.profile_id=? AND c.source=? AND (?='twitch' OR c.session_id IS ?)) OR (? AND c.message_id IS NULL)
      ORDER BY m.timestamp DESC,m.rowid DESC LIMIT ?`).all(profileId,source,source,sessionId,Number(legacy),limit) as ChatRecord[];
    return rows.map(r=>({...r,isBotResponse:Boolean(r.isBotResponse)})).reverse();
  }
  feed(limit=100,sessionId?:number,offset=0): FeedMessage[] {
    const rows=this.db.prepare(`SELECT m.id,m.username,m.message,m.timestamp,m.is_bot_response,c.profile_id,c.session_id,c.source,c.reply_to_id,c.operation_id FROM messages m LEFT JOIN message_context c ON c.message_id=m.id
      ${sessionId===undefined?'':'WHERE c.session_id=?'} ORDER BY m.timestamp DESC,m.rowid DESC LIMIT ? OFFSET ?`).all(...(sessionId===undefined?[]:[sessionId]),limit,offset) as any[];
    return rows.map(r=>({id:r.id,username:r.username,message:r.message,timestamp:r.timestamp,isBotResponse:Boolean(r.is_bot_response),profileId:r.profile_id??undefined,sessionId:r.session_id,source:r.source??'legacy',replyToId:r.reply_to_id??undefined,operationId:r.operation_id??undefined})).reverse();
  }
  sessions(offset=0,limit=20): PageResult<SessionSummary> {
    const rows=this.db.prepare(`SELECT s.*,p.name AS profile_name FROM sessions s LEFT JOIN profiles p ON p.id=s.profile_id ORDER BY s.id DESC LIMIT ? OFFSET ?`).all(limit,offset) as any[];
    return {items:rows.map(r=>this.sessionSummary(r)),total:(this.db.prepare('SELECT count(*) AS n FROM sessions').get() as {n:number}).n,offset,limit};
  }
  private sessionSummary(r:any):SessionSummary {
    const ops=(this.db.prepare('SELECT data FROM operations WHERE session_id=?').all(r.id) as {data:string}[]).map(o=>JSON.parse(o.data) as Operation);
    const usages=ops.map(o=>o.usage?.totalTokens);
    return {id:r.id,profileId:r.profile_id??null,profileName:r.profile_name??null,startTime:r.start_time,endTime:r.end_time,messageCount:r.message_count,legacy:Boolean(r.legacy),operationCount:ops.length,totalTokens:usages.length && usages.every(n=>typeof n==='number')?usages.reduce<number>((n,v)=>n+(v??0),0):null};
  }
  sessionDetail(id:number,offset=0,limit=200):SessionDetail {
    const row=this.db.prepare('SELECT s.*,p.name AS profile_name FROM sessions s LEFT JOIN profiles p ON p.id=s.profile_id WHERE s.id=?').get(id);
    if(!row) throw new Error('Сессия не найдена.');
    return {session:this.sessionSummary(row),messages:this.feed(limit,id,offset),operations:(this.db.prepare('SELECT data FROM operations WHERE session_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(id,limit,offset) as {data:string}[]).map(r=>JSON.parse(r.data))};
  }
  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS viewers (
        id INTEGER PRIMARY KEY,
        twitch_id TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        viewer_id INTEGER,
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        is_bot_response INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (viewer_id) REFERENCES viewers(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_viewer ON messages(viewer_id);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
        start_time TEXT NOT NULL,
        end_time TEXT,
        message_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }
  getSettings(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const saved: Record<string, unknown> = {};
    for (const r of rows) {
      if (secretKeys.includes(r.key as typeof secretKeys[number]) || r.key === 'vts_auth_token') continue;
      try { saved[r.key] = JSON.parse(r.value); }
      catch { this.db.prepare('DELETE FROM settings WHERE key=?').run(r.key); }
    }
    return { ...defaultSettings, ...saved } as Settings;
  }
  saveSettings(change: Partial<Settings>): Settings {
    if (secretKeys.some(key => Object.hasOwn(change, key))) throw new Error('Secrets cannot be saved as settings.');
    const insert = this.db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const tx = this.db.transaction((entries: [string, unknown][]) => {
      for (const [key, value] of entries) insert.run(key, JSON.stringify(value));
    });
    tx(Object.entries(change));
    const active=this.db.prepare('SELECT value FROM workspace_state WHERE key=?').get('active_profile') as {value:string}|undefined;
    if(active) {
      this.db.prepare('UPDATE profiles SET settings=? WHERE id=?').run(JSON.stringify(pickProfileSettings(this.getSettings())),active.value);
      if(Object.hasOwn(change,'live2dModelPath')) this.db.prepare('INSERT OR REPLACE INTO workspace_state VALUES (?,?)').run(`model:${active.value}`,change.live2dModelPath??'');
    }
    return this.getSettings();
  }
  async migrateSecrets(persist: (values: Partial<SecretValues>) => Promise<void>): Promise<void> {
    const legacy: Partial<SecretValues> = {};
    let found = false;
    const find = this.db.prepare('SELECT value FROM settings WHERE key=?');
    for (const key of secretKeys) {
      const row = find.get(key) as { value: string } | undefined;
      if (!row) continue;
      found = true;
      const value: unknown = JSON.parse(row.value);
      if (typeof value !== 'string') throw new Error(`Invalid legacy secret: ${key}`);
      if (value && value !== '***') legacy[key] = value;
    }
    if (Object.keys(legacy).length) await persist(legacy);
    this.db.transaction(() => {
      const remove = this.db.prepare('DELETE FROM settings WHERE key=?');
      for (const key of secretKeys) remove.run(key);
    })();
    if (found) this.db.exec('VACUUM');
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }
  recordChat(message: ChatMessage,countInSession=true): boolean {
    if(this.db.prepare('SELECT id FROM messages WHERE id=?').get(message.id))return false;
    const now = message.timestamp;
    const tx = this.db.transaction(() => {
      let viewer = this.db.prepare('SELECT id FROM viewers WHERE twitch_id=?').get(message.twitchId) as { id: number } | undefined;
      if (!viewer) {
        const r = this.db
          .prepare('INSERT INTO viewers (twitch_id,username,first_seen,last_seen,message_count) VALUES (?,?,?,?,1)')
          .run(message.twitchId, message.username, now, now);
        viewer = { id: Number(r.lastInsertRowid) };
      } else {
        this.db.prepare('UPDATE viewers SET username=?,last_seen=?,message_count=message_count+1 WHERE id=?')
          .run(message.username, now, viewer.id);
      }
      this.db.prepare('INSERT OR IGNORE INTO messages (id,viewer_id,username,message,timestamp,is_bot_response) VALUES (?,?,?,?,?,0)')
        .run(message.id, viewer.id, message.username, message.message, now);
    });
    tx();
    if(countInSession)this.onChatRecorded();
    return true;
  }
  recordBotResponse(text: string,author='bot'): string {
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO messages (id,username,message,timestamp,is_bot_response) VALUES (?,?,?,?,1)')
      .run(id, author, text, new Date().toISOString());
    return id;
  }
  context(limit: number, opts: ContextOptions = {}): ChatRecord[] {
    if (limit <= 0) return [];
    const sql = opts.excludeBot
      ? 'SELECT username, message, timestamp, is_bot_response as isBotResponse FROM messages WHERE is_bot_response=0 ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT username, message, timestamp, is_bot_response as isBotResponse FROM messages ORDER BY timestamp DESC LIMIT ?';
    const rows = this.db.prepare(sql).all(limit) as { username: string; message: string; timestamp: string; isBotResponse: number }[];
    return rows.map((r) => ({
      username: r.username,
      message: r.message,
      timestamp: r.timestamp,
      isBotResponse: Boolean(r.isBotResponse),
    })).reverse();
  }
  viewer(twitchId: string) {
    return this.db.prepare('SELECT username,first_seen,last_seen,message_count FROM viewers WHERE twitch_id=?').get(twitchId);
  }
  startSession(profileId?:string): number {
    const r = this.db.prepare('INSERT INTO sessions (start_time,profile_id,legacy) VALUES (?,?,?)').run(new Date().toISOString(),profileId??null,profileId?0:1);
    return Number(r.lastInsertRowid);
  }
  endSession(id: number, messageCount: number): void {
    this.db.prepare('UPDATE sessions SET end_time=?, message_count=? WHERE id=?').run(new Date().toISOString(), messageCount, id);
  }
  currentSessionId: number | null = null;
  messageCountInSession = 0;
  onChatRecorded(): void {
    if (this.currentSessionId !== null) this.messageCountInSession++;
  }
  raw(): Database.Database { return this.db; }
  orm(): BetterSQLite3Database<typeof schema> { return this.ormDb; }
}
