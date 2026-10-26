import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { api, websocketUrl } from '../hooks/api';
import type { Settings } from '../../shared/types';
import { Live2DCanvas } from '../live2d/Live2DCanvas';
import { VectorAvatar } from './VectorAvatar';
import '../media.css';
import { useCopy } from '../i18n/useCopy';

export type AvatarState = 'loading' | 'loaded' | 'error';
const backgrounds = { transparent: 'transparent', 'chroma-green': '#00ff00', 'chroma-blue': '#0000ff', 'chroma-magenta': '#ff00ff' };

class AvatarBoundary extends Component<{children: ReactNode;onError:(message:string)=>void}, {error?:string}> {
  state: {error?: string} = {};
  static getDerivedStateFromError(error: Error) { return {error:error.message}; }
  componentDidCatch(error: Error) { this.props.onError(error.message); }
  render() { return this.state.error ? null : this.props.children; }
}

/** A visual only: the main application remains the only owner of audio. */
export function AvatarPreview({ settings, mouthOpen = 0, onState, clean = false }: {settings: Settings;mouthOpen?:number;onState?:(state:AvatarState,error?:string)=>void;clean?:boolean}) {
  const c=useCopy();
  const [blinking, setBlinking] = useState(false);
  const [error, setError] = useState('');
  const [fallback, setFallback] = useState(false);
  const [retry, setRetry] = useState(0);
  const stateRef = useRef(onState); stateRef.current = onState;
  useEffect(() => { setError(''); setFallback(false); }, [settings.live2dModelPath]);
  useEffect(() => {
    if (!settings.live2dModelPath) stateRef.current?.('loaded');
    else if (fallback) stateRef.current?.('error',c('Live2D недоступна. Показан временный SVG-аватар.','Live2D is unavailable. Showing a temporary SVG avatar.'));
  }, [settings.live2dModelPath, fallback]);
  useEffect(() => {
    let blinkEnd: ReturnType<typeof setTimeout>;
    const timer = setInterval(() => { setBlinking(true); blinkEnd = setTimeout(() => setBlinking(false), 180); }, 4500);
    return () => { clearInterval(timer); clearTimeout(blinkEnd); };
  }, []);
  const live2d = Boolean(settings.live2dModelPath && !fallback);
  const report = (state: AvatarState, message?: string) => { setError(state === 'error' ? message || c('Ошибка модели','Model error') : ''); stateRef.current?.(state, message); };
  const retryModel = () => {setFallback(false);setRetry(n => n + 1);setError('');};
  return <div className="avatar-preview" style={{background: backgrounds[settings.avatarBackground || 'transparent']}}>
    {live2d ? <AvatarBoundary key={settings.live2dModelPath + ':' + retry} onError={message => report('error', message)}>
      <Live2DCanvas modelPath={settings.live2dModelPath} scale={settings.live2dScale ?? 1} offsetX={settings.live2dOffsetX} offsetY={settings.live2dOffsetY} mouthOpen={mouthOpen} onState={report} clean={clean} />
    </AvatarBoundary> : <div className="vector-avatar" style={{position:'absolute',left:(50+(settings.live2dOffsetX||0))+'%',top:(50+(settings.live2dOffsetY||0))+'%',transform:'translate(-50%,-50%) scale(' + ((settings.live2dScale ?? 1) * (1 + mouthOpen * .02)) + ')'}}><VectorAvatar mouthOpen={mouthOpen} blinking={blinking}/></div>}
    {error && !clean && <div className="avatar-error" role="alert"><p>{error}</p><button type="button" onClick={retryModel}>{c('Повторить','Retry')}</button> <button type="button" className="secondary" onClick={() => {setFallback(true);setError('');}}>{c('Показать SVG','Show SVG')}</button></div>}
    {fallback && !clean && <div className="avatar-error" role="status"><p>{c('Показан временный SVG-аватар. Модель Live2D пока недоступна.','Showing a temporary SVG avatar. The Live2D model is still unavailable.')}</p><button type="button" className="secondary" onClick={retryModel}>{c('Повторить загрузку Live2D','Retry Live2D')}</button></div>}
  </div>;
}

export function AvatarOverlay() {
  const c=useCopy();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mouthOpen, setMouthOpen] = useState(0);
  const sendRef = useRef<(message:{type:string;payload:unknown})=>void>(() => {});
  const stateRef = useRef<{state:AvatarState;error?:string}>({state:'loading'});
  const instanceRef = useRef('');
  useEffect(() => { void api<Settings>('/api/settings').then(setSettings).catch(() => {}); }, []);
  const ws = useWebSocket({url:websocketUrl(), onMessage:message => {
    if (message.type === 'snapshot') { const snapshot = message.payload as {settings:Settings;serverInstanceId:string}; setSettings(snapshot.settings); if(instanceRef.current!==snapshot.serverInstanceId){instanceRef.current=snapshot.serverInstanceId;sendRef.current({type:'avatar_state',payload:stateRef.current});} }
    if (message.type === 'settings') setSettings(message.payload as Settings);
    if (message.type === 'lipsync') setMouthOpen(Math.max(0,Math.min(1,(message.payload as {value:number}).value || 0)));
    if (message.type === 'tts_cancel') setMouthOpen(0);
  }, onStatus:state => { if(state !== 'open') {setMouthOpen(0);instanceRef.current='';} }});
  sendRef.current = ws.send;
  const report = (state:AvatarState,error?:string) => { stateRef.current={state,error};sendRef.current({type:'avatar_state',payload:stateRef.current}); };
  const close = () => {
    const control = (window as unknown as {avatarControl?:{closeWindow:()=>void}}).avatarControl;
    if(control) control.closeWindow(); else window.close();
  };
  const clean = settings?.overlayClean ?? true;
  return <div className={'avatar-overlay ' + (clean ? 'is-clean' : '')}>
    {!clean && <div className="overlay-controls"><span>{c('Аватар · управление в главном окне','Avatar · controls in the main window')}</span><button type="button" aria-label={c('Закрыть окно аватара','Close avatar window')} onClick={close}>{c('Закрыть','Close')}</button></div>}
    {settings && <AvatarPreview settings={settings} mouthOpen={mouthOpen} onState={report} clean={clean}/>}
  </div>;
}
