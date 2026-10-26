import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot, RuntimeCommand, ProductEvent } from '../../shared/product';
import type { Settings } from '../../shared/types';
import { api, websocketUrl } from './api';
import { useWebSocket } from './useWebSocket';
import { TtsClient } from '../tts-client';
import { mergeSnapshot } from './workspace-state';

export function useWorkspace(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [connection,setConnection]=useState<'connecting'|'open'|'closed'>('connecting');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [mouthOpen,setMouthOpen]=useState(0);
  const current=useRef<Snapshot|null>(null),client=useRef<TtsClient|null>(null),owner=useRef(false);
  const retiredInstances=useRef(new Set<string>());
  const sendRef=useRef<(msg:{type:string;payload:unknown})=>void>(()=>{});
  const accept=useCallback((next:Snapshot)=>{
    if(retiredInstances.current.has(next.serverInstanceId))return;
    if(current.current&&current.current.serverInstanceId!==next.serverInstanceId){retiredInstances.current.add(current.current.serverInstanceId);client.current?.cancel();setMouthOpen(0);owner.current=false;sendRef.current({type:'player_ready',payload:{}});}
    const merged=mergeSnapshot(current.current,next);current.current=merged;setSnapshot(merged);
  },[]);
  const refresh=useCallback(async()=>{const instance=current.current?.serverInstanceId;const next=await api<Snapshot>('/api/snapshot');if(current.current?.serverInstanceId!==instance&&next.serverInstanceId!==current.current?.serverInstanceId)return;accept(next);},[accept]);
  useEffect(()=>{let active=true;const load=async()=>{try{await refresh();}catch(e){if(active)setError((e as Error).message);}};void load();},[refresh]);
  const ws=useWebSocket({url:websocketUrl(),onStatus:state=>{
    setConnection(state);
    if(state!=='open'){client.current?.cancel();owner.current=false;setMouthOpen(0);}
    else {sendRef.current({type:'player_ready',payload:{}});setError('');}
  },onMessage:message=>{
    const event=message as ProductEvent;
    if(event.type==='snapshot') {accept({...event.payload as Snapshot,seq:event.seq});return;}
    if(current.current && event.serverInstanceId!==current.current.serverInstanceId){client.current?.cancel();owner.current=false;return;}
    if(current.current && event.seq<=current.current.seq)return;
    if(current.current)current.current={...current.current,seq:event.seq};
    if(event.type==='player_granted'){owner.current=true;return;}
    if(event.type==='tts_speak'&&owner.current) client.current?.speak(event.payload as Parameters<TtsClient['speak']>[0]);
    if(event.type==='tts_cancel')client.current?.cancel();
    if(event.type==='status'&&current.current){current.current={...current.current,status:event.payload as Snapshot['status']};setSnapshot(current.current);}
    if(event.type==='queue'&&current.current){current.current={...current.current,queue:event.payload as Snapshot['queue']};setSnapshot(current.current);}
    if(event.type==='lipsync')setMouthOpen((event.payload as {value:number}).value);
    if(event.type==='log'&&current.current){current.current={...current.current,logs:[event.payload as Snapshot['logs'][number],...current.current.logs].slice(0,200)};setSnapshot(current.current);}
    if(event.type==='player_warning')setError((event.payload as {message:string}).message);
  }});
  sendRef.current=ws.send;
  useEffect(()=>{const player=new TtsClient({send:msg=>sendRef.current(msg)});player.init();client.current=player;return()=>{player.cancel();client.current=null;};},[]);
  const run=useCallback(async<T,>(action:()=>Promise<T>):Promise<T>=>{
    setBusy(true);setError('');try{return await action();}catch(e){setError((e as Error).message);throw e;}finally{setBusy(false);}
  },[]);
  const command=useCallback(async(command:RuntimeCommand)=>{await run(()=>api(`/api/runtime/${command}`,{method:'POST'}));await refresh();},[run,refresh]);
  const test=useCallback((text:string)=>run(()=>api<{operationId:string}>('/api/test-message',{method:'POST',body:JSON.stringify({text})})),[run]);
  const save=useCallback(async(data:Partial<Settings>)=>{await run(async()=>{await api('/api/settings',{method:'PUT',body:JSON.stringify(data)});await refresh();});},[run,refresh]);
  const avatarState=useCallback((state:'loaded'|'loading'|'error',error?:string)=>sendRef.current({type:'avatar_state',payload:{state,error}}),[]);
  return {snapshot,connection,busy,error,command,test,save,refresh,avatarState,mouthOpen};
}
