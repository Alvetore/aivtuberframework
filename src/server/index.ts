import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import {
  validatorCompiler,
  serializerCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { EventBus } from './event-bus.js';
import { AppDatabase } from './database.js';
import { OpenAICompatibleProvider } from './llm.js';
import { TwitchConnector } from './twitch.js';
import { ConversationEngine } from './conversation.js';
import { TtsQueue } from './tts.js';
import { Secrets, persistInElectron } from './secrets.js';
import { secretKeys, type SecretValues } from '../shared/secrets.js';
import { registerLocalAccess } from './local-access.js';
import { registerLocalFiles } from './local-files.js';
import { registerSileroRoutes } from './silero.js';
import { VTubeStudioProvider, DisabledAvatarProvider, type AvatarProvider, type VtsAuthStorage } from './avatar.js';
import type { LogEntry, Settings, Status } from '../shared/types.js';
import { SettingsPutSchema, TestMessageSchema } from '../shared/schemas.js';
import { RuntimeCommandSchema, SnapshotSchema, PublicSettingsSchema, QueueSchema, StatusSchema, LogSchema, ProfileSchema, WorkspacePayloadSchema, ConnectionCheckSchema, type Snapshot, type WorkspacePayload, type ConnectionCheck } from '../shared/product.js';
import { registerProfileRoutes } from './profiles.js';
import { registerSettingsMutationGuard } from './settings-mutation.js';
import { redactSecrets } from './redact.js';
import { z } from 'zod';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
  routerOptions: { maxParamLength: 32768 },
}).withTypeProvider<ZodTypeProvider>();

app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body: string, done) => {
  if (!body || body.trim() === '') {
    done(null, {});
    return;
  }
  try {
    const json = JSON.parse(body);
    done(null, json);
  } catch (err) {
    done(err as Error, undefined);
  }
});

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
app.setErrorHandler((error,_request,reply)=>{
  const invalid=error instanceof z.ZodError;
  const failure=error as {statusCode?:number;message?:string};
  reply.status(invalid?400:(failure.statusCode??500)).send({error:invalid?'Некорректные данные запроса.':redactSecrets(failure.message??'Ошибка сервера.')});
});

const bus = new EventBus();
const db = new AppDatabase();
const llm = new OpenAICompatibleProvider();
const secrets = new Secrets(persistInElectron);
await db.migrateSecrets(values => secrets.update(values, true));
let settings = db.getSettings();
const twitch = new TwitchConnector(bus);
const logs: LogEntry[] = [];
const clients = new Set<{ send(data: string): void; readyState: number; on: (event: string, handler: (data: unknown) => void) => void }>();
type Client = typeof clients extends Set<infer T> ? T : never;
let player:Client|null=null;
let internalAvatar: 'loaded'|'loading'|'error'='loading';
const serverInstanceId=crypto.randomUUID();
let seq=0;
let llmCheck:ConnectionCheck={state:effectiveSettings().llmApiKey?'configured':'unconfigured'};
let connectionRevision=0;
let settingsMutation=false;

const vtsStorage: VtsAuthStorage = {
  getToken: () => secrets.get('vtsAuthToken'),
  setToken: async (token) => { await secrets.update({ vtsAuthToken: token }); },
};

let avatarProvider: AvatarProvider = settings.avatarMode === 'vtube-studio'
  ? new VTubeStudioProvider(settings.vtubeStudioUrl, bus, vtsStorage)
  : new DisabledAvatarProvider();

if (settings.avatarMode === 'vtube-studio') {
  void avatarProvider.connect();
}

function effectiveSettings(): Settings & SecretValues { return secrets.effective(settings); }
function maskedSettings(): Settings { return PublicSettingsSchema.parse(secrets.publicSettings(settings)) as Settings; }

const publish = (type: string, payload: unknown, validated = false) => {
  const schema={snapshot:SnapshotSchema,workspace:WorkspacePayloadSchema,checks:ConnectionCheckSchema,settings:PublicSettingsSchema,status:StatusSchema,queue:QueueSchema,log:LogSchema,profiles:ProfileSchema.array(),response:z.object({text:z.string(),operationId:z.string().optional()}),lipsync:z.object({value:z.number().min(0).max(1)}),tts_speak:z.object({id:z.string(),text:z.string(),engine:z.enum(['webspeech','silero','openai','elevenlabs']),audio:z.string().optional(),mime:z.string().optional(),voice:z.string().optional(),language:z.string().optional(),volume:z.number().optional(),outputDeviceId:z.string().optional()}),tts_cancel:z.object({}),tts_start:z.object({text:z.string(),engine:z.string()}),tts_end:z.object({}),avatar_state:z.object({state:z.enum(['loading','loaded','error']),error:z.string().optional()})}[type];
  if(schema&&!validated)payload=schema.parse(payload);
  const data = JSON.stringify({ type, payload,serverInstanceId,seq:++seq });
  for (const client of clients) {
    if(type==='tts_speak' && client!==player) continue;
    // The OBS overlay only needs settings/lipsync; keep the large workspace payload for the main window.
    if(type==='workspace' && client!==player) continue;
    if (client.readyState === 1) client.send(data);
  }
};

const status = (): Status => {
  const eff = effectiveSettings();
  let avatarStatus: Status['avatar'] = 'disabled';
  if (settings.avatarMode === 'vtube-studio') {
    avatarStatus = avatarProvider.isConnected ? 'connected' : 'disconnected';
  } else if (settings.avatarMode === 'internal') {
    avatarStatus = internalAvatar==='loaded' ? 'connected' : 'disconnected';
  }
  return {
    twitch: twitch.isConnected ? 'connected' : 'disconnected',
    llm: eff.llmApiKey ? 'ready' : 'unconfigured',
    tts: !settings.ttsEnabled ? 'disabled' : tts.state,
    avatar: avatarStatus,
  };
};

const tts = new TtsQueue({ bus, publish, getSettings: () => effectiveSettings(), getStatus: () => status(), onOperation:(...args)=>engine.updateOperation(...args) });
function snapshot():Snapshot {return SnapshotSchema.parse({serverInstanceId,seq,serverTime:Date.now(),settings:maskedSettings(),status:status(),runtime:engine.state,profiles:db.listProfiles(),feed:db.profileFeed(db.activeProfileId()),operations:db.profileOperations(db.activeProfileId(),100,[engine.activeOperationId,tts.snapshot.operationId]),queue:tts.snapshot,logs,checks:{llm:llmCheck}}) as Snapshot;}
function workspaceState():WorkspacePayload {return {runtime:engine.state,profiles:db.listProfiles(),feed:db.profileFeed(db.activeProfileId()),operations:db.profileOperations(db.activeProfileId(),100,[engine.activeOperationId,tts.snapshot.operationId]),checks:{llm:llmCheck}};}
let workspaceScheduled=false;
function scheduleWorkspace(){if(workspaceScheduled)return;workspaceScheduled=true;setImmediate(()=>{workspaceScheduled=false;publish('workspace',workspaceState());});}
function publishChecks(){publish('checks',llmCheck);}

bus.on('LOG', (entry) => {
  const eff=effectiveSettings();
  const log: LogEntry = { id: crypto.randomUUID(), time: new Date().toISOString(), ...entry,message:redactSecrets(entry.message,secretKeys.map(k=>eff[k])) };
  const checksChanged=entry.source==='Conversation'&&entry.level==='error';
  if(checksChanged)llmCheck={state:'error',message:log.message};
  logs.unshift(log);
  logs.splice(200);
  publish('log', log);
  if(checksChanged)publishChecks();
});
bus.on('LLM_RESPONSE', (response) => {
  llmCheck={state:'response_verified',checkedAt:new Date().toISOString()};
  publish('response', response);
  publishChecks();
});
bus.on('TTS_START', (payload) => {
  publish('tts_start', payload);
  publish('status', status());
});
bus.on('TTS_END', () => {
  publish('tts_end', {});
  publish('status', status());
});
bus.on('LIPSYNC_UPDATE', (payload) => {
  publish('lipsync', payload);
  avatarProvider.setLipSync(payload.value);
});
bus.on('AVATAR_CONNECTED', () => {
  publish('status', status());
});
bus.on('AVATAR_DISCONNECTED', () => {
  publish('status', status());
});
bus.on('TWITCH_CONNECTED', () => {
  publish('status', status());
});
bus.on('TWITCH_DISCONNECTED', () => {
  publish('status', status());
});

const engine = new ConversationEngine(db, llm, bus, () => effectiveSettings(), tts,{twitch:()=>twitch.isConnected,player:()=>Boolean(player?.readyState===1)});
bus.on('WORKSPACE_CHANGED',scheduleWorkspace);
const streamerTimer = setInterval(() => void engine.streamerTick(), 5_000);
let lipTest:ReturnType<typeof setInterval>|undefined;
function cancelLipTest(){if(lipTest)clearInterval(lipTest);lipTest=undefined;bus.emit('LIPSYNC_UPDATE',{value:0});}
bus.on('WORKSPACE_CHANGED',()=>{if(engine.state.state==='running'&&lipTest)cancelLipTest();});

app.addHook('onRequest', async (request, reply) => {
  const id = request.headers['x-request-id']?.toString() ?? crypto.randomUUID();
  reply.header('x-request-id', id);
  (request as { id: string }).id = id;
});
app.addHook('onSend', async (request, reply, payload) => {
  if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  return payload;
});
registerSettingsMutationGuard(app, () => settingsMutation);

registerLocalAccess(app, process.env.APP_SESSION_TOKEN ?? '', process.env.VITE_DEV_ORIGIN);
await app.register(websocket);

app.get('/api/settings', () => maskedSettings());
app.get('/api/snapshot',()=>snapshot());
app.get('/api/operations/:id',(request,reply)=>{const id=z.string().uuid().parse((request.params as {id:string}).id);const op=db.getOperation(id);return op??reply.code(404).send({error:'Операция не найдена.'});});
app.post('/api/runtime/:command', async (request)=>{cancelLipTest();return engine.command(RuntimeCommandSchema.parse((request.params as {command:string}).command));});
app.post('/api/avatar/lipsync-test',async()=>{
  if(engine.state.state==='running')throw Object.assign(new Error('Поставьте эфир на паузу перед проверкой lip-sync.'),{statusCode:409});
  cancelLipTest();const started=Date.now();lipTest=setInterval(()=>{const elapsed=Date.now()-started;if(elapsed>2000){cancelLipTest();return;}bus.emit('LIPSYNC_UPDATE',{value:(Math.sin(elapsed/95)+1)/2});},50);return {ok:true};
});
app.get('/api/sessions', request=>{const q=z.object({offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(20)}).parse(request.query);return db.sessions(q.offset,q.limit);});
app.get('/api/sessions/:id',request=>{const id=z.coerce.number().int().positive().parse((request.params as {id:string}).id);const q=z.object({offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(200).default(200)}).parse(request.query);return db.sessionDetail(id,q.offset,q.limit);});
function applySettings(next:Settings, options:{twitchCredentialsChanged?:boolean}={}){
  const previous=settings;settings=next;tts.cancel();tts.rebuild();
  if(previous.avatarMode!==next.avatarMode||previous.vtubeStudioUrl!==next.vtubeStudioUrl){
    avatarProvider.disconnect();avatarProvider=next.avatarMode==='vtube-studio'?new VTubeStudioProvider(next.vtubeStudioUrl,bus,vtsStorage):new DisabledAvatarProvider();
    if(next.avatarMode==='vtube-studio') void avatarProvider.connect();
  }
  const twitchIdentityChanged=previous.twitchUsername!==next.twitchUsername||previous.twitchChannel!==next.twitchChannel;
  if((twitchIdentityChanged||options.twitchCredentialsChanged)&&twitch.isConnected){
    twitch.disconnect();
    const effective=effectiveSettings();
    if(effective.twitchUsername&&effective.twitchChannel&&effective.twitchOauthToken) twitch.connect(effective);
  }
  if(previous.live2dModelPath!==next.live2dModelPath||previous.avatarMode!==next.avatarMode) internalAvatar='loading';
  engine.profileSelected();publish('settings',maskedSettings());publish('status',status());
}
registerProfileRoutes(app,db,{getRuntime:()=>engine.state,beforeSelect:()=>engine.beforeProfileSelect(),applySettings,publish:(type,payload)=>{publish(type,payload);scheduleWorkspace();},getPublicSettings:maskedSettings});
app.put(
  '/api/settings',
  { schema: { body: SettingsPutSchema } },
  async (request) => {
    if(settingsMutation)throw Object.assign(new Error('Настройки уже применяются.'),{statusCode:409});
    if(engine.state.state==='running') throw Object.assign(new Error('Поставьте эфир на паузу перед изменением настроек.'),{statusCode:409});
    settingsMutation=true;
    try {
    const incoming = { ...request.body } as Partial<Settings> & Partial<SecretValues>;
    const previousEffective = effectiveSettings();
    const previousSecrets = Object.fromEntries(secretKeys.map(key => [key, previousEffective[key]])) as SecretValues;
    engine.command('interrupt');
    const changes: Partial<SecretValues> = {};
    for (const key of secretKeys) {
      const value = incoming[key];
      if (value !== undefined && value !== '***') changes[key] = value;
      delete incoming[key];
    }
    await secrets.update(changes);
    let saved: Settings;
    try {
      saved = db.saveSettings(incoming);
    } catch (error) {
      // The vault was already updated; restore it if the settings transaction fails.
      if (Object.keys(changes).length) await secrets.update(previousSecrets).catch(() => {});
      throw error;
    }
    const nextEffective = secrets.effective({ ...settings, ...incoming });
    if (previousEffective.llmEndpoint !== nextEffective.llmEndpoint
      || previousEffective.llmApiKey !== nextEffective.llmApiKey
      || previousEffective.llmModel !== nextEffective.llmModel) {
      connectionRevision++;
      llmCheck = { state: nextEffective.llmApiKey ? 'configured' : 'unconfigured' };
      publishChecks();
    }
    applySettings(saved, { twitchCredentialsChanged: Object.hasOwn(changes, 'twitchOauthToken') });
    bus.emit('LOG', { level: 'info', source: 'Settings', message: 'Настройки сохранены.' });
    publish('settings', maskedSettings());
    publish('status', status());
    return maskedSettings();
    }finally{settingsMutation=false;}
  },
);
app.post('/api/avatar/connect', async () => {
  if (settings.avatarMode === 'vtube-studio') {
    await avatarProvider.connect();
  }
  publish('status', status());
  return { ok: true, status: status().avatar };
});
app.post('/api/avatar/disconnect', async () => {
  avatarProvider.disconnect();
  publish('status', status());
  return { ok: true, status: status().avatar };
});

registerLocalFiles(app, process.env.RENDERER_ROOT, () => settings.live2dModelPath);
app.get('/api/status', () => status());
app.get('/api/logs', () => logs);
app.get('/api/health', async () => ({ ok: true }));

const cleanupSilero = registerSileroRoutes(app, bus, () => effectiveSettings());

app.post('/api/llm/models', async (request, reply) => {
  if(engine.state.state==='running') return reply.status(409).send({error:'Поставьте эфир на паузу перед проверкой подключения.'});
  const eff = effectiveSettings();
  const body = z.object({endpoint:z.string().url().optional(),apiKey:z.string().optional()}).parse(request.body??{});
  const endpoint = (body.endpoint || eff.llmEndpoint || 'https://api.openai.com/v1').replace(/\/$/, '');
  const savedEndpoint = eff.llmEndpoint.replace(/\/$/, '');
  const suppliedKey = body.apiKey && !body.apiKey.includes('***') ? body.apiKey : '';
  // The saved key must never be sent to a caller-supplied endpoint.
  const apiKey = suppliedKey || (endpoint === savedEndpoint ? eff.llmApiKey : '');
  const revision=connectionRevision;
  const savedConfig=endpoint===savedEndpoint&&apiKey===eff.llmApiKey;
  const check=(next:ConnectionCheck)=>{if(savedConfig&&revision===connectionRevision){llmCheck=next;publishChecks();}};

  if (!apiKey) {
    return reply.status(400).send({
      ok: false,
      error: endpoint === savedEndpoint
        ? 'Укажите API key для получения списка моделей.'
        : 'Для нового endpoint укажите API key в этом запросе. Сохранённый ключ не отправляется на другие адреса.',
    });
  }

  const url = `${endpoint}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  check({state:'checking'});
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      return reply.status(res.status).send({
        ok: false,
        error: `API вернул статус ${res.status}: ${redactSecrets(errText,[apiKey]).slice(0, 160)}`,
      });
    }
    const data = (await res.json()) as { data?: { id?: string }[] };
    if (!Array.isArray(data.data)) {
      return reply.send({ ok: true, models: [] });
    }
    const models = data.data
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
      .sort((a, b) => a.localeCompare(b));
    check({state:'api_verified',checkedAt:new Date().toISOString(),message:'Список моделей получен. Генерация ещё не проверена.'});
    return { ok: true, models };
  } catch (err) {
    const msg = redactSecrets(err instanceof Error ? err.message : String(err),[apiKey]);
    check({state:'error',message:msg});
    return reply.status(500).send({ ok: false, error: `Не удалось загрузить модели: ${msg}` });
  } finally { clearTimeout(timer); if(llmCheck.state==='checking')check({state:'error',message:'API не подтвердил доступ.'}); }
});

app.post('/api/twitch/connect', async () => {
  if(twitch.isConnected) return {ok:true};
  const s=effectiveSettings();if(!s.twitchUsername||!s.twitchChannel||!s.twitchOauthToken) throw Object.assign(new Error('Заполните логин, канал и OAuth token Twitch.'),{statusCode:400});
  twitch.connect(effectiveSettings());
  publish('status', status());
  return { ok: true };
});
app.post('/api/twitch/disconnect', async () => {
  engine.sourceLost('twitch_lost');
  twitch.disconnect();
  publish('status', status());
  return { ok: true };
});
app.post('/api/tts/cancel', async () => {
  // Audio-only stop: do not abort an in-flight text generation.
  tts.cancel();
  return { ok: true };
});
app.post('/api/tts/preview',async request=>{
  if(engine.state.state==='running')throw Object.assign(new Error('Поставьте эфир на паузу перед прослушиванием.'),{statusCode:409});
  if(!player)throw Object.assign(new Error('Аудиоплеер не подключён.'),{statusCode:409});
  const {text}=TestMessageSchema.parse(request.body);await tts.preview(text);return {ok:true};
});

app.post(
  '/api/test-message',
  { schema: { body: TestMessageSchema } },
  async (request) => {
    return engine.test(request.body.text);
  },
);

app.get('/ws', { websocket: true }, (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify({ type: 'snapshot', payload: snapshot(),serverInstanceId,seq }));
  const handler = (raw: unknown) => {
    const text = typeof raw === 'string' ? raw : raw instanceof Buffer ? raw.toString() : '';
    if (!text) return;
    let decoded:unknown;try{decoded=JSON.parse(text);}catch{return;}
    const parsed=z.object({type:z.string(),payload:z.object({text:z.string().max(32000).optional(),value:z.number().finite().optional(),id:z.string().optional(),error:z.string().max(1000).optional(),state:z.enum(['loaded','error','loading']).optional(),message:z.string().max(1000).optional()}).default({})}).safeParse(decoded);
    if(!parsed.success)return;const msg=parsed.data;
    if(msg.type==='player_ready'){
      // A reconnecting main window must be able to take ownership even before
      // the server observes the old socket's close event.
      player=socket;
      socket.send(JSON.stringify({type:'player_granted',payload:{},serverInstanceId,seq:++seq}));
      return;
    }
    if (msg.type === 'tts_done' && player===socket && typeof msg.payload.text === 'string') {
      tts.notifyDone(msg.payload.text, msg.payload.id,msg.payload.error);
    } else if(msg.type==='tts_started'&&player===socket&&typeof msg.payload.text==='string'){
      tts.notifyStarted(msg.payload.text,msg.payload.id);
    } else if (msg.type === 'lipsync' && player===socket && typeof msg.payload?.value === 'number') {
      bus.emit('LIPSYNC_UPDATE', { value: Math.max(0, Math.min(1, msg.payload.value)) });
    } else if(msg.type==='avatar_state' && msg.payload.state && internalAvatar!==msg.payload.state){
      internalAvatar=msg.payload.state;publish('avatar_state',msg.payload);publish('status',status());
    } else if(msg.type==='player_warning' && player===socket){
      bus.emit('LOG',{level:'error',source:'Audio',message:redactSecrets(msg.payload.message??'Ошибка аудиоплеера')});
    }
  };
  socket.on('message', handler);
  socket.on('close', () => {clients.delete(socket);if(player===socket){player=null;engine.sourceLost('player_lost');tts.cancel();}});
});

app.addHook('preClose', async () => {
  clearInterval(streamerTimer); cancelLipTest();engine.command('stop'); twitch.disconnect(); avatarProvider.disconnect();
  for (const client of clients) (client as unknown as { close(): void }).close();
  await cleanupSilero();
});
app.addHook('onClose', async () => { db.raw().close(); });
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('message', raw => { if ((raw as { type?: string })?.type === 'shutdown') void shutdown(); });
process.on('disconnect', () => void shutdown());
await app.listen({ port: Number(process.env.PORT ?? 3001), host: '127.0.0.1' });
process.send?.({ type: 'server:ready', port: (app.server.address() as { port: number }).port });
