import {afterEach,describe,it,expect,vi} from 'vitest';
import {AppDatabase} from '../database';
import {ConversationEngine} from '../conversation';
import {EventBus} from '../event-bus';
import {OpenAICompatibleProvider} from '../llm';
import {defaultSettings,type Settings} from '../../shared/types';
import type {TtsQueue} from '../tts';

const databases:AppDatabase[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.raw().close();vi.restoreAllMocks();});
function setup(settings:Partial<Settings>={}){
 const db=new AppDatabase(':memory:');databases.push(db);
 let resolve!:(result:{text:string;usage?:{promptTokens:number;completionTokens:number;totalTokens:number}})=>void;
 const chat=vi.fn((_s,_m,_signal:AbortSignal)=>new Promise<{text:string}>(done=>{resolve=done;}));
 const tts={enqueue:vi.fn(),cancel:vi.fn(),state:'idle'} as unknown as TtsQueue;
 const engine=new ConversationEngine(db,{chatWithUsage:chat} as unknown as OpenAICompatibleProvider,new EventBus(),()=>({...defaultSettings,llmApiKey:'fake',responseCooldownSeconds:0,...settings}),tts);
 return {db,engine,chat,tts,finish:(text='answer')=>resolve({text,usage:{promptTokens:3,completionTokens:2,totalTokens:5}})};
}
describe('workspace lifecycle invariants',()=>{
 it('starts stopped; test runs without Twitch and returns operation ID before provider completion',async()=>{
  const {db,engine,finish}=setup();expect(engine.state.state).toBe('stopped');
  const accepted=await engine.test('hello');expect(db.recentOperations()[0].id).toBe(accepted.operationId);expect(db.recentOperations()[0].stage).toBe('generating');
  finish();await new Promise(resolve=>setImmediate(resolve));expect(db.feed().filter(m=>m.isBotResponse)).toHaveLength(1);expect(engine.state.sessionId).toBeNull();
 });
 it.each(['pause','stop','interrupt'] as const)('aborts %s and rejects late result even if provider ignores AbortSignal',async command=>{
  const {db,engine,chat,finish,tts}=setup();engine.command('start');
  const operation=engine.onMessage({twitchId:'alice',username:'Alice',message:'How are you?'});
  engine.command(command);expect(chat.mock.calls[0][2].aborted).toBe(true);
  finish();await operation;expect(db.feed().some(m=>m.isBotResponse)).toBe(false);expect(tts.enqueue).not.toHaveBeenCalled();
  expect(db.recentOperations()[0]).toMatchObject({outcome:'cancelled',usage:{totalTokens:5}});
 });
 it('mute during generation preserves text but unmute cannot resurrect that audio',async()=>{
  const {db,engine,finish,tts}=setup();engine.command('start');const pending=engine.onMessage({twitchId:'a',username:'A',message:'How are you?'});
  engine.command('mute');engine.command('unmute');finish();await pending;
  expect(db.feed().some(m=>m.isBotResponse)).toBe(true);expect(tts.enqueue).not.toHaveBeenCalled();
 });
 it('double start is idempotent; profile change on pause closes old session and resume creates a new one',()=>{
  const {db,engine}=setup();engine.command('start');const first=engine.state.sessionId;engine.command('start');expect(engine.state.sessionId).toBe(first);
  expect(()=>engine.beforeProfileSelect()).toThrow('паузу');engine.command('pause');engine.beforeProfileSelect();
  const next=db.createProfile('Other');db.selectProfile(next.id);engine.profileSelected();expect(engine.state).toMatchObject({state:'paused',sessionId:null,profileId:next.id});
  engine.command('resume');expect(engine.state.sessionId).not.toBe(first);expect(db.sessionDetail(first!).session.endTime).toBeTruthy();
 });
 it('source loss pauses without automatic resumption',()=>{
  const {engine}=setup();engine.command('start');engine.sourceLost('player_lost');expect(engine.state).toMatchObject({state:'paused',reason:'player_lost'});
 });
 it('keeps an active operation reachable after hundreds of busy chat decisions',async()=>{
  const {db,engine,finish}=setup();engine.command('start');const work=engine.onMessage({twitchId:'first',username:'First',message:'How are you?'});const active=engine.activeOperationId!;
  for(let i=0;i<220;i++)await engine.onMessage({twitchId:'other',username:'Other',message:`Question ${i}?`});
  expect(db.profileOperations(db.activeProfileId(),100,[active]).some(op=>op.id===active)).toBe(true);
  engine.updateOperation(active,'queued','pending');expect(db.getOperation(active)?.finishedAt).toBeUndefined();
  engine.command('interrupt');finish();await work;expect(db.getOperation(active)).toMatchObject({outcome:'cancelled',reason:'interrupted'});
 });
 it('retains the cancellation reason when the speech queue synchronously terminates its operation',async()=>{
  const {db,engine,finish,tts}=setup();engine.command('start');const work=engine.onMessage({twitchId:'a',username:'A',message:'How are you?'});const id=engine.activeOperationId!;finish();await work;
  vi.mocked(tts.cancel).mockImplementation(()=>engine.updateOperation(id,'finished','cancelled'));
  engine.command('mute');expect(db.getOperation(id)).toMatchObject({outcome:'cancelled',reason:'muted'});
 });
 it('local tests during a paused live session do not increase its message count',async()=>{
  const {db,engine,finish}=setup();engine.command('start');const session=engine.state.sessionId!;engine.command('pause');await engine.test('local only');finish();await new Promise(resolve=>setImmediate(resolve));engine.command('stop');expect(db.sessionDetail(session).session.messageCount).toBe(0);
 });
 it('idle initiative never invents a Twitch viewer or incoming chat message',async()=>{
  const {db,engine,finish}=setup({mode:'streamer',idleTimeoutSeconds:5});engine.command('start');
  db.recordChat({id:'older',twitchId:'real',username:'Real viewer',message:'Earlier topic',timestamp:new Date(Date.now()-10_000).toISOString(),badges:[]});db.tagMessage('older',{profileId:db.activeProfileId(),sessionId:engine.state.sessionId,source:'twitch'});
  const tick=engine.streamerTick();finish();await tick;
  expect(db.feed().filter(m=>!m.isBotResponse).map(m=>m.username)).toEqual(['Real viewer']);expect(db.viewer('')).toBeUndefined();expect(db.recentOperations()[0]).toMatchObject({trigger:'idle'});expect(db.recentOperations()[0]).not.toHaveProperty('messageId');
 });
 it('new tests inherit no dialogue or first-profile legacy context',async()=>{
  const {db,engine,chat,finish}=setup();db.recordBotResponse('legacy sentinel');await engine.test('new input');
  expect(JSON.stringify(chat.mock.calls[0][1])).not.toContain('legacy sentinel');finish();await new Promise(resolve=>setImmediate(resolve));
 });
});
