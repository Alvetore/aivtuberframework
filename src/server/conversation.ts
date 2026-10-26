import type { EventBus } from './event-bus.js';
import type { AppDatabase } from './database.js';
import type { ChatMessage, Settings } from '../shared/types.js';
import type { Operation, RuntimeCommand, RuntimeState } from '../shared/product.js';
import { OpenAICompatibleProvider } from './llm.js';
import { buildMessages } from './prompt-builder.js';
import type { TtsQueue } from './tts.js';
import { redactSecrets } from './redact.js';
import { secretKeys } from '../shared/secrets.js';

function conflict(message:string):never {throw Object.assign(new Error(message),{statusCode:409});}

/** Owns broadcast lifecycle, cancellation and generation publication guards. */
export class ConversationEngine {
  private lastResponseAt = 0;
  private responseTimes: number[] = [];
  private generation = 0;
  private audioGeneration = 0;
  private active?: {controller:AbortController;operation:Operation;generation:number;audioGeneration:number};
  private runtime:RuntimeState;
  constructor(private db:AppDatabase,private llm:OpenAICompatibleProvider,private bus:EventBus,private settings:()=>Settings,private tts?:TtsQueue,
    private environment:{twitch:()=>boolean;player:()=>boolean}={twitch:()=>true,player:()=>true}) {
    this.runtime={state:'stopped',muted:false,sessionId:null,profileId:db.activeProfileId(),cooldownUntil:0};
    bus.on('CHAT_MESSAGE',m=>void this.onMessage(m));
    bus.on('TWITCH_DISCONNECTED',()=>this.sourceLost('twitch_lost'));
  }
  get state():RuntimeState {return {...this.runtime};}
  get activeOperationId(){return this.active?.operation.id;}
  private changed(){this.bus.emit('WORKSPACE_CHANGED',undefined);}
  private safeError(error:string){const s=this.settings();return redactSecrets(error,secretKeys.map(k=>s[k]));}
  private operation(op:Operation){this.db.saveOperation(op);this.changed();}
  updateOperation(id:string,stage:Operation['stage'],outcome?:Operation['outcome'],error?:string,metrics?:{synthesisMs?:number;playbackMs?:number}) {
    const op=this.db.getOperation(id);
    if(!op || op.outcome!=='pending') return;
    const terminal=outcome!==undefined&&outcome!=='pending';
    this.operation({...op,...metrics,stage,outcome:outcome??op.outcome,...(error?{error:this.safeError(error)}:{}),...(terminal?{finishedAt:new Date().toISOString()}: {})});
  }
  private cancel(reason:string){
    this.generation++;
    if(this.active){this.active.controller.abort();this.operation({...this.active.operation,stage:'finished',outcome:'cancelled',reason,finishedAt:new Date().toISOString()});this.active=undefined;}
    const pending=this.db.pendingOperations();
    this.tts?.cancel();
    for(const op of pending) this.operation({...op,stage:'finished',outcome:'cancelled',reason,finishedAt:new Date().toISOString()});
  }
  command(command:RuntimeCommand):RuntimeState {
    if(command==='start'||command==='resume') {
      if(this.runtime.state==='running') return this.state;
      const s=this.settings();
      if(!s.llmApiKey || !s.llmModel) conflict('Укажите модель и API-ключ в подключениях.');
      if(!this.environment.twitch()) conflict('Подключите Twitch перед запуском эфира.');
      if(s.ttsEnabled && !this.environment.player()) conflict('Аудиоплеер не подключён. Откройте главный экран.');
      this.cancel('new_run');
      if(this.runtime.sessionId===null) {this.runtime.sessionId=this.db.startSession(this.db.activeProfileId());this.db.currentSessionId=this.runtime.sessionId;}
      this.runtime.state='running';this.runtime.reason=undefined;
    } else if(command==='pause') {
      if(this.runtime.state==='running'){this.runtime.state='paused';this.runtime.reason='user_pause';}
      this.cancel('paused');
    } else if(command==='stop') {
      this.runtime.state='stopped';this.runtime.reason=undefined;this.cancel('stopped');this.endSession();
    } else if(command==='interrupt') this.cancel('interrupted');
    else if(command==='mute') {
      this.runtime.muted=true;this.audioGeneration++;
      const pending=this.db.pendingOperations();this.tts?.cancel();
      for(const op of pending) if(op.stage!=='generating') this.operation({...op,stage:'finished',outcome:'cancelled',reason:'muted',finishedAt:new Date().toISOString()});
    } else this.runtime.muted=false;
    this.runtime.profileId=this.db.activeProfileId();this.changed();return this.state;
  }
  private endSession(){if(this.runtime.sessionId!==null) this.db.endSession(this.runtime.sessionId,this.db.messageCountInSession);this.runtime.sessionId=null;this.db.currentSessionId=null;this.db.messageCountInSession=0;}
  sourceLost(reason:string){if(this.runtime.state==='running'){this.runtime.state='paused';this.runtime.reason=reason;this.cancel(reason);this.changed();}}
  beforeProfileSelect(){if(this.runtime.state==='running') conflict('Поставьте эфир на паузу перед сменой профиля.');this.cancel('profile_changed');this.endSession();this.lastResponseAt=0;this.responseTimes=[];this.runtime.cooldownUntil=0;}
  profileSelected(){this.runtime.profileId=this.db.activeProfileId();this.changed();}
  async test(text:string):Promise<{operationId:string}> {
    if(this.runtime.state==='running') conflict('Поставьте эфир на паузу перед тестированием.');
    if(this.active) conflict('Дождитесь проверки или прервите текущую реплику.');
    const operationId=crypto.randomUUID();
    void this.receive({id:crypto.randomUUID(),twitchId:'test-user',username:'Тестовый зритель',message:text,timestamp:new Date().toISOString(),badges:[]},'test',true,operationId).catch(error=>this.bus.emit('LOG',{level:'error',source:'Conversation',message:redactSecrets(String(error))}));
    return {operationId};
  }
  async onMessage(input:Pick<ChatMessage,'twitchId'|'username'|'message'> & Partial<ChatMessage>) {
    const message:ChatMessage={id:input.id??crypto.randomUUID(),timestamp:input.timestamp??new Date().toISOString(),badges:input.badges??[],...input};
    return this.receive(message,'twitch',false);
  }
  private async receive(message:ChatMessage,source:'twitch'|'test',force:boolean,operationId=crypto.randomUUID(),recordInput=true):Promise<{operationId:string}> {
    const sessionId=source==='test'?null:this.runtime.sessionId;
    const profileId=this.db.activeProfileId();
    if(recordInput){
      if(!this.db.recordChat(message,source==='twitch'))return {operationId};
      this.db.tagMessage(message.id,{profileId,sessionId,source});
      if(source==='twitch' && sessionId!==null) this.db.raw().prepare('UPDATE sessions SET message_count=message_count+1 WHERE id=?').run(sessionId);
    }
    let op:Operation={id:operationId,messageId:recordInput?message.id:undefined,trigger:recordInput?'message':'idle',author:message.username,prompt:message.message,profileId,sessionId,source,stage:'received',outcome:'pending',createdAt:new Date().toISOString()};
    const now=Date.now(),s=this.settings();
    this.responseTimes=this.responseTimes.filter(t=>now-t<60_000);
    let reason:string|undefined,retryAfterMs:number|undefined;
    if(!force && this.runtime.state!=='running') reason=this.runtime.state;
    else if(!force && !this.addressed(message.message,s) && !this.question(message.message)) reason='not_addressed';
    else if(this.active) reason='busy';
    else if(!s.llmApiKey||!s.llmModel) reason='unconfigured';
    else if(!force && now<this.lastResponseAt+s.responseCooldownSeconds*1000){reason='cooldown';retryAfterMs=this.lastResponseAt+s.responseCooldownSeconds*1000-now;}
    else if(!force && this.responseTimes.length>=s.maxResponsesPerMinute){reason='minute_limit';retryAfterMs=this.responseTimes[0]+60_000-now;}
    if(reason){this.operation({...op,stage:'finished',outcome:'skipped',reason,retryAfterMs,finishedAt:new Date().toISOString()});return {operationId:op.id};}
    op={...op,stage:'generating'};
    const run={controller:new AbortController(),operation:op,generation:this.generation,audioGeneration:this.audioGeneration};this.active=run;this.operation(op);
    const started=Date.now();
    try{
      const context=source==='test'?[]:this.db.scopedContext(s.contextMessageLimit,profileId,source,sessionId).filter(r=>r.timestamp!==message.timestamp || r.message!==message.message);
      const messages=buildMessages(s,context,source==='twitch'&&recordInput?this.db.viewer(message.twitchId):undefined,message.message);
      this.bus.emit('LLM_REQUEST',{prompt:message.message});
      const result=await this.llm.chatWithUsage(s,messages,run.controller.signal);
      op={...op,llmMs:Date.now()-started,usage:result.usage,attempts:result.attempts};
      if(run.generation!==this.generation||run.controller.signal.aborted){this.operation({...op,stage:'finished',outcome:'cancelled',reason:this.db.getOperation(op.id)?.reason??'cancelled',finishedAt:new Date().toISOString()});return {operationId:op.id};}
      const completedAt=Date.now();
      if(source==='twitch'){this.lastResponseAt=completedAt;this.responseTimes.push(completedAt);this.runtime.cooldownUntil=completedAt+s.responseCooldownSeconds*1000;}
      const replyId=this.db.recordBotResponse(result.text,s.characterName);
      this.db.tagMessage(replyId,{profileId,sessionId,source,replyToId:recordInput?message.id:undefined,operationId:op.id});
      op={...op,text:result.text,replyId};
      const audio=s.ttsEnabled&&!this.runtime.muted&&run.audioGeneration===this.audioGeneration&&this.environment.player()&&Boolean(this.tts);
      this.operation({...op,stage:audio?'queued':'finished',outcome:audio?'pending':'completed',...(audio?{}:{finishedAt:new Date().toISOString()})});
      this.bus.emit('LLM_RESPONSE',{text:result.text,operationId:op.id});
      if(audio) this.tts?.enqueue(result.text,op.id);
    }catch(error){
      const cancelled=run.generation!==this.generation||run.controller.signal.aborted;
      const message=this.safeError(error instanceof Error?error.message:String(error));
      this.operation({...op,llmMs:Date.now()-started,attempts:(error as {attempts?:number})?.attempts,stage:'finished',outcome:cancelled?'cancelled':'failed',reason:cancelled?(this.db.getOperation(op.id)?.reason??'cancelled'):undefined,error:cancelled?undefined:message,finishedAt:new Date().toISOString()});
      if(!cancelled) this.bus.emit('LOG',{level:'error',source:'Conversation',message});
    }finally{if(this.active===run)this.active=undefined;this.changed();}
    return {operationId:op.id};
  }
  private addressed(text:string,s:Settings){const name=s.characterName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(?:^|\\s)@?${name}(?=[,.!?:\\s]|$)`,'iu').test(text);}
  private question(text:string){return text.includes('?')&&text.trim().split(/\s+/).length>=2;}
  async streamerTick(){
    const s=this.settings();
    if(this.runtime.state!=='running'||s.mode!=='streamer'||this.active||this.tts?.state==='speaking')return;
    const recent=this.db.scopedContext(1,this.db.activeProfileId(),'twitch',this.runtime.sessionId)[0];
    if(!recent||Date.now()-Date.parse(recent.timestamp)<s.idleTimeoutSeconds*1000)return;
    await this.receive({id:crypto.randomUUID(),twitchId:'',username:s.characterName,message:`${s.characterName}, поддержи разговор со зрителями по недавним темам чата.`,timestamp:new Date().toISOString(),badges:[]},'twitch',false,crypto.randomUUID(),false);
  }
}
