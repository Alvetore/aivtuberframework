import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../shared/types';
import type { FeedMessage, Operation, Snapshot } from '../../shared/product';
import { StatusCards } from '../components/StatusCards';
import { ChatTester } from '../components/ChatTester';
import { LogsView, filterLogs } from '../components/LogsView';
import { MessageFeed, OperationDetail, LivePage } from './LivePage';
import { Onboarding } from './Onboarding';
import { commandBlockReason, formatDuration, operationLabel } from './workspace-copy';

function fixture(): Snapshot {
  return { serverInstanceId:'server-a', seq:0, serverTime:Date.now(), settings:{...defaultSettings, llmApiKey:'***'}, status:{twitch:'connected', llm:'ready', tts:'idle', avatar:'disabled'}, runtime:{state:'stopped',muted:false,sessionId:null,profileId:'first',cooldownUntil:0}, profiles:[],feed:[],operations:[],queue:{state:'idle',pending:0},logs:[],checks:{llm:{state:'configured'}} };
}
function operation(patch: Partial<Operation> = {}): Operation {
  return {id:'op-a',author:'Viewer',prompt:'How are you?',profileId:'first',sessionId:null,source:'test',stage:'generating',outcome:'pending',createdAt:'2026-10-25T00:00:00Z',...patch};
}
const render = <P extends object>(component: ComponentType<P>, props: P) => renderToStaticMarkup(createElement(component, props));

describe('Workspace presentation invariants', () => {
  it('blocks live commands until connection and credentials exist', () => {
    const snapshot = fixture();
    expect(commandBlockReason(snapshot,'start',false,false)).toContain('связь');
    snapshot.settings.llmApiKey = '';
    expect(commandBlockReason(snapshot,'start',true,false)).toContain('модель');
    snapshot.settings.llmApiKey = '***'; snapshot.status.twitch = 'disconnected';
    expect(commandBlockReason(snapshot,'resume',true,false)).toContain('Twitch');
    snapshot.status.twitch = 'connected';
    expect(commandBlockReason(snapshot,'start',true,false)).toBe('');
  });
  it('does not claim an answer while generating or after failure', () => {
    expect(operationLabel(operation())).toBe('Генерация ответа');
    expect(operationLabel(operation({outcome:'failed'}))).toBe('Ошибка');
    expect(operationLabel(operation({outcome:'completed'}))).toBe('Ответ получен');
    const html = render(ChatTester, {});
    expect(html).toContain('Проверить ответ');
    expect(html).not.toContain('Отправлено');
    expect(html).not.toContain('Ответ получен');
  });
  it('shows configured credentials separately from verified response', () => {
    const html = render(StatusCards, {status:fixture().status, check:{state:'configured'}});
    expect(html).toContain('не проверена');
    expect(html).not.toContain('Готов');
    const verified = render(StatusCards, {status:fixture().status, check:{state:'response_verified'}});
    expect(verified).toContain('Ответ получен');
  });
  it('preserves author and reply link in the conversation', () => {
    const messages: FeedMessage[] = [
      {id:'viewer-message',username:'Alice',message:'Hello?',timestamp:'2026-10-25T00:00:00Z',isBotResponse:false,source:'twitch'},
      {id:'response-message',username:'Host',message:'Hello Alice!',timestamp:'2026-10-25T00:00:01Z',isBotResponse:true,source:'twitch',replyToId:'viewer-message',operationId:'op-a'},
    ];
    const html = render(MessageFeed,{messages, operations:[operation({outcome:'completed',stage:'finished'})]});
    expect(html).toContain('href="#message-viewer-message"');
    expect(html).toContain('для Alice: Hello?');
    expect(html).toContain('Hello Alice!');
    expect(html.match(/id="message-viewer-message"/g)).toHaveLength(1);
  });
  it('shows unknown metrics as unknown and preserves factual zero', () => {
    const unknown = render(OperationDetail,{operation:operation({outcome:'completed'})});
    expect(unknown).toContain('Нет данных');
    expect(formatDuration(undefined)).toBe('Нет данных');
    expect(formatDuration(0)).toBe('0 мс');
    expect(render(OperationDetail,{operation:operation({llmMs:0,usage:{promptTokens:0,completionTokens:0,totalTokens:0}})})).toContain('0 мс');
  });
  it('filters logs by level, source and normalized search', () => {
    const logs = [{id:'1',time:'2026-10-25T00:00:00Z',level:'error' as const,source:'LLM',message:'Bad model'}, {id:'2',time:'2026-10-25T00:00:01Z',level:'info' as const,source:'Twitch',message:'Connected'}];
    expect(filterLogs(logs,'error','all',' MODEL ')).toEqual([logs[0]]);
    expect(filterLogs(logs,'all','Twitch','')).toEqual([logs[1]]);
    expect(filterLogs(logs,'info','LLM','')).toEqual([]);
    expect(render(LogsView,{logs:[]})).toContain('Событий пока нет');
  });
  it('offers local testing and configuration in an empty project without live start', () => {
    const snapshot = fixture(); snapshot.settings.llmApiKey = ''; snapshot.status.twitch = 'disconnected';
    const html = render(LivePage,{snapshot,connected:true,busy:false,error:'',onCommand:async()=>{},onTest:async()=>({operationId:'test'}),onNavigate:()=>{}});
    expect(html).toContain('Здесь начнётся разговор');
    expect(html).toContain('Без Twitch');
    expect(html).toContain('Настройте модель');
    expect(html).toContain('Начать эфир');
    const onboarding = render(Onboarding,{snapshot,onNavigate:()=>{}});
    expect(onboarding).toContain('Подготовим вашу ведущую');
    expect(onboarding).toContain('aria-current="step"');
    expect(onboarding.match(/<li>/g)).toHaveLength(5);
  });
});
