import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Settings } from '../../shared/types';
import { TtsFormSchema, type TtsFormData } from './schemas';
import { FormShell, Field, Select, Checkbox, KeyField } from './FormShell';
import { useFormDraft } from './drafts';
import { api } from '../hooks/api';
import '../media.css';
import { useCopy } from '../i18n/useCopy';

interface Props { initial: Settings; onSave:(data:TtsFormData)=>Promise<void>; saving:boolean;notice?:string;runtimeState?:'stopped'|'running'|'paused'; }
export function TtsForm({initial,onSave,saving,notice,runtimeState='stopped'}:Props) {
  const c=useCopy();
  const defaults: TtsFormData = {
    ttsEnabled:initial.ttsEnabled,ttsVoice:initial.ttsVoice || '',ttsEngine:initial.ttsEngine,
    ttsLanguage:initial.ttsLanguage || 'ru-RU',ttsVolume:initial.ttsVolume ?? 1,audioOutputDeviceId:initial.audioOutputDeviceId || '',
    sileroEndpoint:initial.sileroEndpoint || 'http://127.0.0.1:5000',sileroSpeaker:initial.sileroSpeaker || 'xenia',sileroSampleRate:initial.sileroSampleRate || 48000,
    openaiTtsEndpoint:initial.openaiTtsEndpoint || 'https://api.openai.com/v1/audio/speech',openaiTtsApiKey:initial.openaiTtsApiKey || '',
    openaiTtsModel:initial.openaiTtsModel || 'tts-1',openaiTtsVoice:initial.openaiTtsVoice || 'nova',
    elevenlabsApiKey:initial.elevenlabsApiKey || '',elevenlabsVoiceId:initial.elevenlabsVoiceId || '',elevenlabsModel:initial.elevenlabsModel || 'eleven_multilingual_v2',
  };
  const form = useForm<TtsFormData>({resolver:zodResolver(TtsFormSchema),defaultValues:defaults});
  const draft = useFormDraft('tts',form,defaults);
  const engine = form.watch('ttsEngine');
  const selectedVoice = form.watch('ttsVoice');
  const selectedDevice = form.watch('audioOutputDeviceId');
  const [voices,setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [devices,setDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputError,setOutputError] = useState('');
  const defaultTestText=c('Привет! Это проверка выбранного голоса.','Hello! This is a test of the selected voice.');
  const [testText,setTestText] = useState(defaultTestText);
  useEffect(()=>{setTestText(old=>old==='Привет! Это проверка выбранного голоса.'||old==='Hello! This is a test of the selected voice.'?defaultTestText:old);},[defaultTestText]);
  const [testing,setTesting] = useState(false);
  const [testResult,setTestResult] = useState('');
  const [error,setError] = useState('');
  const [silero,setSilero] = useState<{running:boolean;gpu?:boolean}>({running:false});
  const [sileroBusy,setSileroBusy] = useState(false);
  const outputSupported = typeof HTMLMediaElement !== 'undefined' && ('setSinkId' in HTMLMediaElement.prototype || (typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype));
  useEffect(() => {
    const speech = window.speechSynthesis;
    if(!speech) return;
    const update = () => setVoices([...speech.getVoices()].sort((a,b)=>a.lang.localeCompare(b.lang)||a.name.localeCompare(b.name)));
    update();speech.addEventListener('voiceschanged',update);
    return ()=>speech.removeEventListener('voiceschanged',update);
  },[]);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if(!media?.enumerateDevices) return;
    const update = () => { void media.enumerateDevices().then(list=>{setDevices(list.filter(d=>d.kind==='audiooutput'&&d.deviceId!=='default'));setOutputError('');}).catch(()=>setOutputError(c('Список устройств недоступен. Используется системный выход.','The device list is unavailable. The system output will be used.'))); };
    update();media.addEventListener('devicechange',update);return ()=>media.removeEventListener('devicechange',update);
  },[]);
  const refreshSilero = async () => {
    try {setSilero(await api<{running:boolean;gpu?:boolean}>('/api/tts/silero/status'));}
    catch {setSilero({running:false});}
  };
  useEffect(()=>{if(engine!=='silero')return;void refreshSilero();const timer=setInterval(()=>void refreshSilero(),8000);return ()=>clearInterval(timer);},[engine]);
  const saveDraft = async () => { if(!await form.trigger())throw new Error(c('Проверьте значения полей.','Check the field values.'));await draft.submit(onSave)(form.getValues()); };
  const preview = async () => {
    setTesting(true);setTestResult('');setError('');
    try {await saveDraft();await api('/api/tts/preview',{method:'POST',body:JSON.stringify({text:testText})});setTestResult(c('Прослушивание завершено.','Voice test completed.'));}
    catch(e){setError((e as Error).message);}finally{setTesting(false);}
  };
  const controlSilero = async (action:'start'|'stop') => {
    setSileroBusy(true);setError('');
    try {await saveDraft();const result=await api<{ok:boolean;error?:string}>('/api/tts/silero/'+action,{method:'POST',body:'{}'});if(!result.ok)throw new Error(result.error||c('Не удалось выполнить команду.','The command failed.'));await refreshSilero();}
    catch(e){setError((e as Error).message);}finally{setSileroBusy(false);}
  };
  const voiceOptions=[{value:'',label:c('Автоматически по языку','Automatic by language')},...voices.map(v=>({value:v.voiceURI||v.name,label:v.name+' · '+v.lang}))];
  const voiceMissing=Boolean(selectedVoice&&!voices.some(v=>v.voiceURI===selectedVoice||v.name===selectedVoice));
  if(voiceMissing)voiceOptions.push({value:selectedVoice,label:selectedVoice+c(' · недоступен',' · unavailable')});
  const deviceOptions=[{value:'',label:c('Системное устройство','System device')},...devices.map((d,index)=>({value:d.deviceId,label:d.label||c('Аудиовыход ','Audio output ')+(index+1)}))];
  if(selectedDevice&&!devices.some(d=>d.deviceId===selectedDevice))deviceOptions.push({value:selectedDevice,label:c('Сохранённый выход · недоступен','Saved output · unavailable')});
  return <FormShell form={form} draft={draft} onSave={form.handleSubmit(draft.submit(onSave))} saving={saving} notice={notice}>
    <Checkbox form={form} name="ttsEnabled" label={c('Озвучивать ответы','Read replies aloud')} tooltip={c('При выключении сохраняются текстовые ответы; очередь речи очищается.','Turning this off keeps text replies and clears the speech queue.')}/>
    <Select form={form} name="ttsEngine" label={c('Синтез речи','Speech synthesis')} options={[{value:'webspeech',label:c('Системный голос · бесплатно','System voice · free')},{value:'silero',label:c('Silero · локальный сервер','Silero · local server')},{value:'openai',label:'OpenAI Audio'},{value:'elevenlabs',label:'ElevenLabs'}]}/>
    {engine==='webspeech'&&<>
      <Select form={form} name="ttsVoice" label={c('Системный голос','System voice')} options={voiceOptions}/>
      {voiceMissing&&<p className="media-warning" role="status">{c('Сохранённый голос сейчас недоступен. При воспроизведении будет выбран доступный голос указанного языка.','The saved voice is unavailable. An available voice for the selected language will be used.')}</p>}
      {voices.length===0&&<p className="media-hint">{c('Список системных голосов пока пуст. Установите голос в настройках Windows или используйте другой синтезатор.','No system voices are available yet. Install a voice in Windows settings or choose another synthesizer.')}</p>}
      <Field form={form} name="ttsLanguage" label={c('Язык голоса','Voice language')} placeholder="ru-RU" tooltip={c('Код языка, например ru-RU или en-US. При автоматическом выборе используется этот язык.','Language code, such as ru-RU or en-US. Automatic voice selection uses this language.')}/>
      <p className="media-hint">{c('Выход: системное устройство Windows. Web Speech не позволяет выбрать отдельный аудиовыход. Движение рта для системного голоса приблизительное.','Output: Windows system device. Web Speech cannot select a separate audio output. System voice lip sync is approximate.')}</p>
    </>}
    {engine==='silero'&&<>
      <div className="media-panel"><div className="media-row"><strong>Silero: {silero.running?c('сервер отвечает','server responds')+(silero.gpu?' · GPU':' · CPU'):c('сервер не отвечает','server does not respond')}</strong><button type="button" className="secondary" disabled={sileroBusy||runtimeState==='running'} onClick={()=>void controlSilero(silero.running?'stop':'start')}>{sileroBusy?c('Выполняется…','Working…'):silero.running?c('Остановить свой сервер','Stop managed server'):c('Применить и запустить','Apply and start')}</button></div><p className="media-hint">{c('Запуск использует установленный Python и зависимости. Чужие процессы не завершаются.','Starting uses the installed Python and dependencies. Other processes are left running.')}</p></div>
      <Select form={form} name="sileroSpeaker" label={c('Голос Silero','Silero voice')} options={['xenia','baya','kseniya','eugene','aidar','random'].map(value=>({value,label:value}))}/>
      <details><summary>{c('Дополнительные параметры Silero','Advanced Silero settings')}</summary><Field form={form} name="sileroEndpoint" label={c('Адрес сервера','Server address')} placeholder="http://127.0.0.1:5000"/><Select form={form} name="sileroSampleRate" label={c('Частота звука','Sample rate')} options={[48000,24000,8000].map(value=>({value,label:value+c(' Гц',' Hz')}))}/></details>
    </>}
    {engine==='openai'&&<>
      <Field form={form} name="openaiTtsModel" label={c('Модель синтеза','Speech model')} placeholder="tts-1"/>
      <Field form={form} name="openaiTtsVoice" label={c('Голос','Voice')} placeholder="nova"/>
      <KeyField form={form} name="openaiTtsApiKey" label={c('Ключ OpenAI Audio','OpenAI Audio key')} saved={Boolean(initial.openaiTtsApiKey)}/>
      <p className="media-hint">{c('Без отдельного ключа используется сохранённый ключ подключения LLM.','Without a separate key, the saved LLM connection key is used.')}</p>
      <details><summary>{c('Адрес API','API address')}</summary><Field form={form} name="openaiTtsEndpoint" label={c('URL синтеза речи','Speech synthesis URL')}/></details>
    </>}
    {engine==='elevenlabs'&&<>
      <KeyField form={form} name="elevenlabsApiKey" label={c('Ключ ElevenLabs','ElevenLabs key')} saved={Boolean(initial.elevenlabsApiKey)}/>
      <Field form={form} name="elevenlabsVoiceId" label={c('ID голоса','Voice ID')}/>
      <Field form={form} name="elevenlabsModel" label={c('Модель','Model')} placeholder="eleven_multilingual_v2"/>
    </>}
    <label className="field">{c('Громкость','Volume')} · {Math.round(Number(form.watch('ttsVolume'))*100)}%<input aria-label={c('Громкость','Volume')} type="range" min="0" max="1" step="0.05" {...form.register('ttsVolume',{valueAsNumber:true})}/></label>
    {engine!=='webspeech'&&<>
      <Select form={form} name="audioOutputDeviceId" label={c('Аудиовыход','Audio output')} options={deviceOptions}/>
      {!outputSupported&&<p className="media-warning">{c('Выбор устройства не поддерживается этим браузером. Воспроизведение использует системный выход.','Output selection is unsupported in this browser. Playback uses the system output.')}</p>}
      {outputError&&<p className="media-warning">{outputError}</p>}
      {selectedDevice&&!devices.some(d=>d.deviceId===selectedDevice)&&<p className="media-warning">{c('Выбранный выход не найден. Если он недоступен при воспроизведении, будет использован системный выход.','The selected output was not found. If it is unavailable during playback, the system output will be used.')}</p>}
      <p className="media-hint">{c('Для списка выходов приложение не запрашивает доступ к микрофону. Часть названий может быть скрыта системой.','The app does not request microphone access to list outputs. The system may hide some device names.')}</p>
    </>}
    <div className="media-panel"><strong>{c('Проверка голоса','Voice test')}</strong><label className="field">{c('Текст пробы','Test text')}<input value={testText} onChange={e=>setTestText(e.target.value)} maxLength={500}/></label><div className="media-row"><button type="button" disabled={testing||saving||runtimeState==='running'||!testText.trim()} onClick={()=>void preview()}>{testing?c('Прослушивание…','Playing…'):c('Применить и прослушать','Apply and listen')}</button><button type="button" className="secondary" onClick={()=>void api('/api/tts/cancel',{method:'POST',body:'{}'}).catch(e=>setError((e as Error).message))}>{c('Прервать звук','Stop audio')}</button></div><p className="media-hint">{runtimeState==='running'?c('Для проверки голоса поставьте эфир на паузу.','Pause the live session to test the voice.'):c('Проба не использует LLM и не входит в историю диалога. Звук может попасть в OBS через захват этого устройства.','The test does not use the LLM or enter dialogue history. OBS may capture audio from this device.')} {engine==='openai'||engine==='elevenlabs'?c('Запрос синтеза может тарифицироваться провайдером.','The provider may charge for speech synthesis.'):''}</p>{testResult&&<p role="status">{testResult}</p>}{error&&<p className="media-error" role="alert">{error}</p>}</div>
  </FormShell>;
}
