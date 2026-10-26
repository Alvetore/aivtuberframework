import { useEffect, useState } from 'react';
import type { Operation } from '../../shared/product';
import { api } from '../hooks/api';
import { operationLabel, reasonLabel, useWorkspaceCopy } from '../pages/workspace-copy';

interface Props {
  onTest?: (text: string) => Promise<{operationId: string}>;
  operations?: Operation[];
  disabled?: boolean;
  disabledReason?: string;
}
export function ChatTester({ onTest, operations = [], disabled = false, disabledReason }: Props) {
  const c = useWorkspaceCopy();
  const en = c('ru', 'en') === 'en';
  const [text, setText] = useState(c('Привет! Как настроение?', 'Hello! How are you doing?'));
  const [busy, setBusy] = useState(false);
  const [acceptedId, setAcceptedId] = useState<string>();
  const [error, setError] = useState('');
  const [archived,setArchived]=useState<Operation>();
  const [lookupError,setLookupError]=useState('');
  const operation = operations.find(item => item.id === acceptedId)??(archived?.id===acceptedId?archived:undefined);
  const missing=Boolean(acceptedId&&!operations.some(item=>item.id===acceptedId));
  useEffect(()=>{
    if(!acceptedId||!missing)return;
    let active=true;let timer:ReturnType<typeof setTimeout>;
    const load=async()=>{try{const op=await api<Operation>(`/api/operations/${acceptedId}`);if(!active)return;setArchived(op);setLookupError('');if(op.outcome==='pending')timer=setTimeout(load,1000);}catch(e){if(active)setLookupError((e as Error).message);}};
    void load();return()=>{active=false;clearTimeout(timer);};
  },[acceptedId,missing]);
  const pending = Boolean(acceptedId && (!operation || operation.outcome === 'pending'));
  const send = async () => {
    setBusy(true); setError(''); setAcceptedId(undefined);
    try {
      const result = await (onTest ? onTest(text) : api<{operationId: string}>('/api/test-message', { method: 'POST', body: JSON.stringify({ text }), timeoutMs: 5000 }));
      setAcceptedId(result.operationId);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <article className="workspace-panel test-panel">
    <div className="panel-heading"><h3>{c('Локальный тест', 'Local test')}</h3><span className="subtle-label">{c('Без Twitch', 'No Twitch needed')}</span></div>
    <p className="hint">{c('Проверка модели и голоса отдельно от живого диалога. Запрос может расходовать токены; звук может попасть в OBS через захват устройства.', 'Test the model and voice separately from the live conversation. Requests may use tokens; device capture in OBS may include this audio.')}</p>
    <label className="sr-only" htmlFor="local-test-message">{c('Тестовое сообщение', 'Test message')}</label><textarea id="local-test-message" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={500} disabled={busy} />
    <div className="test-actions"><button type="button" onClick={() => void send()} disabled={disabled || busy || pending || !text.trim()}>{busy || pending ? c('Ожидание ответа…', 'Waiting for response…') : c('Проверить ответ', 'Test response')}</button><span className="hint">{text.length}/500</span></div>
    {disabledReason && <p className="hint">{disabledReason}</p>}
    <div aria-live="polite">{error && <p className="inline-error" role="alert">{error}</p>}{acceptedId && <div className={`test-result outcome-${operation?.outcome ?? 'pending'}`}><strong>{operation ? operationLabel(operation, en) : c('Запрос принят. Ожидаем результат…', 'Request accepted. Waiting for the result…')}</strong>{operation?.reason && <p>{reasonLabel(operation.reason, en)}</p>}{operation?.error && <p role="alert">{operation.error}</p>}{operation?.text && <p>{operation.text}</p>}{operation?.outcome === 'failed' && <p className="hint">{c('Проверьте модель и ключ в «Подключениях», затем повторите тест.', 'Check the model and key in Connections, then retry.')}</p>}</div>}</div>
    {lookupError&&<p className="inline-error" role="alert">{lookupError}<button type="button" className="secondary" onClick={()=>{setAcceptedId(undefined);setLookupError('');}}>{c('Закрыть результат','Dismiss result')}</button></p>}
  </article>;
}
