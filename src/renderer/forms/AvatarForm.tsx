import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Settings } from '../../shared/types';
import { AvatarFormSchema, type AvatarFormData } from './schemas';
import { FormShell, Field, Select, Checkbox } from './FormShell';
import { useFormDraft } from './drafts';
import { AvatarPreview } from '../components/AvatarOverlay';
import { api } from '../hooks/api';
import '../media.css';
import { useCopy } from '../i18n/useCopy';

interface Props {initial:Settings;onSave:(data:AvatarFormData)=>Promise<void>;saving:boolean;notice?:string;runtimeState?:'stopped'|'running'|'paused';}
interface AvatarControl {isOpen:()=>Promise<boolean>;openWindow:()=>Promise<void>;closeWindow:()=>Promise<void>;selectModel:()=>Promise<{ok?:boolean;modelPath?:string;extracted?:boolean;modelName?:string;error?:string;canceled?:boolean}>}
export function AvatarForm({initial,onSave,saving,notice,runtimeState='stopped'}:Props) {
  const c=useCopy(); const defaults:AvatarFormData={avatarMode:initial.avatarMode,vtubeStudioUrl:initial.vtubeStudioUrl,live2dModelPath:initial.live2dModelPath||'',live2dScale:initial.live2dScale??1,live2dOffsetX:initial.live2dOffsetX??0,live2dOffsetY:initial.live2dOffsetY??0,overlayClean:initial.overlayClean??true,avatarBackground:initial.avatarBackground||'transparent'};
  const form=useForm<AvatarFormData>({resolver:zodResolver(AvatarFormSchema),defaultValues:defaults});
  const draft=useFormDraft('avatar',form,defaults);
  const [windowOpen,setWindowOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [result,setResult]=useState('');
  const [previewState,setPreviewState]=useState('loading');
  const [mouth,setMouth]=useState(0);
  const lipTimer=useRef<ReturnType<typeof setInterval>>();
  const browserWindow=useRef<Window|null>(null);
  const values=form.watch();
  const control=()=> (window as unknown as {avatarControl?:AvatarControl}).avatarControl;
  useEffect(()=>{
    const update=()=>{const native=control();if(native)void native.isOpen().then(setWindowOpen).catch(()=>{});else setWindowOpen(Boolean(browserWindow.current&&!browserWindow.current.closed));};
    update();const timer=setInterval(update,2000);return()=>clearInterval(timer);
  },[]);
  useEffect(()=>()=>{if(lipTimer.current)clearInterval(lipTimer.current);},[]);
  const saveDraft=async()=>{if(!await form.trigger())throw new Error(c('Проверьте параметры аватара.','Check the avatar settings.'));await draft.submit(onSave)(form.getValues());};
  const toggleWindow=async()=>{
    setBusy(true);setError('');
    try {
      if(windowOpen){const native=control();if(native)await native.closeWindow();else browserWindow.current?.close();setWindowOpen(false);}
      else {await saveDraft();const native=control();if(native)await native.openWindow();else {browserWindow.current=window.open(window.location.origin+'?view=avatar','vtuber-avatar','width=520,height=720');if(!browserWindow.current)throw new Error(c('Окно заблокировано браузером.','The browser blocked the window.'));}setWindowOpen(true);}
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const selectModel=async()=>{
    setError('');setResult('');setBusy(true);
    try {const native=control();if(!native)throw new Error(c('Выбор файлов доступен в настольном приложении.','File selection is available in the desktop app.'));const res=await native.selectModel();if(res.canceled)return;if(!res.ok||!res.modelPath)throw new Error(res.error||c('Не удалось прочитать модель.','Could not read the model.'));form.setValue('live2dModelPath',res.modelPath,{shouldDirty:true});setResult(c('Выбрана модель ','Selected model ')+(res.modelName||res.modelPath)+c('. Примените настройки для загрузки.','. Apply settings to load it.'));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const connectVts=async()=>{
    setBusy(true);setError('');setResult('');
    try {await saveDraft();const res=await api<{status:string}>('/api/avatar/connect',{method:'POST',body:'{}'});if(res.status!=='connected')throw new Error(c('VTube Studio пока не подключён. Разрешите доступ в окне VTube Studio и повторите проверку.','VTube Studio is not connected yet. Allow access in VTube Studio and try again.'));setResult(c('Доступ VTube Studio подтверждён.','VTube Studio access verified.'));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const testLip=async()=>{
    setError('');setResult('');
    try {await saveDraft();await api('/api/avatar/lipsync-test',{method:'POST',body:'{}'});if(lipTimer.current)clearInterval(lipTimer.current);const started=Date.now();lipTimer.current=setInterval(()=>{const elapsed=Date.now()-started;if(elapsed>=2000){clearInterval(lipTimer.current);lipTimer.current=undefined;setMouth(0);setResult(c('Проба движения рта завершена.','Lip sync test completed.'));return;}setMouth((Math.sin(elapsed/95)+1)*.4);},50);}
    catch(e){setError((e as Error).message);}
  };
  const previewSettings:Settings={...initial,...values,live2dModelPath:initial.live2dModelPath};
  return <FormShell form={form} draft={draft} onSave={form.handleSubmit(draft.submit(onSave))} saving={saving} notice={notice}>
    <Select form={form} name="avatarMode" label={c('Способ отображения','Avatar display')} options={[{value:'disabled',label:c('Без аватара','No avatar')},{value:'internal',label:c('Аватар в приложении · Live2D или SVG','In-app avatar · Live2D or SVG')},{value:'vtube-studio',label:'VTube Studio'}]}/>
    {values.avatarMode==='internal'&&<>
      <div className="media-preview"><AvatarPreview settings={previewSettings} mouthOpen={mouth} onState={(state,message)=>{setPreviewState(state);if(message)setError(message);}}/></div>
      <p className="media-hint" role="status">{previewState==='loaded'?(initial.live2dModelPath?c('Live2D загружена.','Live2D loaded.'):c('Отображается встроенный SVG-аватар.','Showing the built-in SVG avatar.')):previewState==='error'?c('Ошибка загрузки модели.','Could not load the model.'):c('Загрузка модели…','Loading model…')}</p>
      <div className="media-row"><button type="button" className="secondary" disabled={busy||saving} onClick={()=>void toggleWindow()}>{windowOpen?c('Закрыть OBS-окно','Close OBS window'):c('Применить и открыть OBS-окно','Apply and open OBS window')}</button><button type="button" className="secondary" disabled={busy||saving||runtimeState==='running'} onClick={()=>void testLip()}>{c('Проверить движение рта','Test lip sync')}</button></div>
      <p className="media-hint">{c('В OBS добавьте «Захват окна» и выберите окно аватара. Звук воспроизводит главное окно приложения; preview и OBS-окно не дублируют речь. Проверка движения рта беззвучная.','Add Window Capture in OBS and select the avatar window. The main app plays audio; preview and OBS windows do not duplicate speech. The lip sync test is silent.')}</p>
      <Checkbox form={form} name="overlayClean" label={c('Чистое окно для OBS','Clean OBS window')} tooltip={c('Убирает панель управления и сообщения из захвата. Все настройки и закрытие окна доступны здесь.','Hides controls and messages from capture. All settings and the window close action remain available here.')}/>
      <Select form={form} name="avatarBackground" label={c('Фон OBS','OBS background')} options={[{value:'transparent',label:c('Прозрачный','Transparent')},{value:'chroma-green',label:c('Зелёный хромакей','Green chroma key')},{value:'chroma-blue',label:c('Синий хромакей','Blue chroma key')},{value:'chroma-magenta',label:c('Пурпурный хромакей','Magenta chroma key')}]}/>
      <div className="media-row"><strong>{c('Модель Live2D','Live2D model')}</strong><button type="button" className="secondary" disabled={busy} onClick={()=>void selectModel()}>{c('Выбрать .model3.json или ZIP','Select .model3.json or ZIP')}</button></div>
      <Field form={form} name="live2dModelPath" label={c('Путь модели','Model path')} placeholder={c('Пустое поле — встроенный SVG','Leave empty for built-in SVG')} tooltip={c('Модель и её ресурсы загружаются только из выбранной папки. После изменения пути примените настройки.','The model and its assets load only from the selected folder. Apply settings after changing the path.')}/>
      {values.live2dModelPath!==initial.live2dModelPath&&<p className="media-warning">{c('Preview показывает последнюю применённую модель. Примените новый путь для загрузки.','Preview shows the last applied model. Apply the new path to load it.')}</p>}
      <div className="media-placement">
        <label className="field">{c('Масштаб','Scale')}<input type="number" min="0.1" max="10" step="0.05" {...form.register('live2dScale',{valueAsNumber:true})}/><small className="media-hint">{c('1 — подогнать в доступную область.','1 fits the available area.')}</small></label>
        <Field form={form} name="live2dOffsetX" label={c('Сдвиг X, %','X offset, %')} type="number"/>
        <Field form={form} name="live2dOffsetY" label={c('Сдвиг Y, %','Y offset, %')} type="number"/>
      </div>
      <div className="media-row"><button type="button" className="secondary" onClick={()=>form.setValue('live2dScale',1,{shouldDirty:true})}>{c('Подогнать','Fit')}</button><button type="button" className="secondary" onClick={()=>{form.setValue('live2dScale',1,{shouldDirty:true});form.setValue('live2dOffsetX',0,{shouldDirty:true});form.setValue('live2dOffsetY',0,{shouldDirty:true});}}>{c('Сбросить размещение','Reset placement')}</button></div>
    </>}
    {values.avatarMode==='vtube-studio'&&<>
      <Field form={form} name="vtubeStudioUrl" label={c('Адрес VTube Studio','VTube Studio address')} placeholder="ws://127.0.0.1:8001"/>
      <p className="media-hint">{c('В VTube Studio включите API и разрешите доступ приложению. Сохранение адреса само по себе не подтверждает подключение.','Enable the API in VTube Studio and allow access for the app. Saving the address does not verify the connection.')}</p>
      <div className="media-row"><button type="button" disabled={busy||saving} onClick={()=>void connectVts()}>{c('Применить и подключить','Apply and connect')}</button><button type="button" className="secondary" disabled={runtimeState==='running'} onClick={()=>void testLip()}>{c('Проверить движение рта','Test lip sync')}</button></div>
    </>}
    {runtimeState==='running'&&<p className="media-hint">{c('Для проверки движения рта поставьте эфир на паузу.','Pause the live session to test lip sync.')}</p>}
    {result&&<p role="status">{result}</p>}{error&&<p className="media-error" role="alert">{error}</p>}
  </FormShell>;
}
