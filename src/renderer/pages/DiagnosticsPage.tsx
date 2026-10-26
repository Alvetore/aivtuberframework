import { useEffect, useState } from 'react';
import type { PageResult, SessionDetail, SessionSummary, Snapshot } from '../../shared/product';
import { LogsView } from '../components/LogsView';
import { api } from '../hooks/api';
import { MessageFeed, OperationDetail } from './LivePage';
import { useWorkspaceCopy } from './workspace-copy';
import './workspace.css';

const SESSION_LIMIT = 20;
const MESSAGE_LIMIT = 200;
export function DiagnosticsPage({ snapshot }: {snapshot: Snapshot}) {
  const c = useWorkspaceCopy();
  const [tab, setTab] = useState<'events'|'history'|'operations'>('events');
  const [page, setPage] = useState<PageResult<SessionSummary>>();
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<number>();
  const [messageOffset, setMessageOffset] = useState(0);
  const [detail, setDetail] = useState<SessionDetail>();
  const [selectedOperation, setSelectedOperation] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (tab !== 'history') return;
    let active = true; setLoading(true); setError('');
    api<PageResult<SessionSummary>>(`/api/sessions?offset=${offset}&limit=${SESSION_LIMIT}`)
      .then(result => { if (active) setPage(result); })
      .catch(e => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tab, offset, revision, snapshot.serverInstanceId]);
  useEffect(() => {
    if (selectedId === undefined || tab !== 'history') return;
    let active = true; setDetailLoading(true); setError('');
    api<SessionDetail>(`/api/sessions/${selectedId}?offset=${messageOffset}&limit=${MESSAGE_LIMIT}`)
      .then(result => { if (active) setDetail(result); })
      .catch(e => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, messageOffset, revision, tab, snapshot.serverInstanceId]);
  const operation = tab === 'history' ? detail?.operations.find(item => item.id === selectedOperation) : snapshot.operations.find(item => item.id === selectedOperation);
  return <div className="diagnostics-page">
    <div className="segmented-control" role="group" aria-label={c('Раздел диагностики', 'Diagnostics section')}><button type="button" className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>{c('События', 'Events')}</button><button type="button" className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}>{c('Реплики и метрики', 'Responses and metrics')}</button><button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>{c('История сессий', 'Session history')}</button></div>
    {tab === 'events' && <article className="workspace-panel"><LogsView logs={snapshot.logs} /></article>}
    {tab === 'operations' && <article className="workspace-panel"><h3>{c('Последние решения ведущей', 'Recent host decisions')}</h3><p className="hint">{c('Данные возвращает провайдер. Пропущенные значения неизвестны, денежная стоимость не рассчитывается.', 'Values are reported by the provider. Missing values are unknown; monetary cost is not estimated.')}</p>{snapshot.operations.length === 0 ? <div className="workspace-empty">{c('Реплик пока нет. Запустите локальный тест на экране «Эфир».', 'No responses yet. Run a local test on the Live page.')}</div> : <div className="operation-list">{snapshot.operations.map(item => <button type="button" className="operation-row" key={item.id} onClick={() => setSelectedOperation(item.id)}><span><strong>{item.author}</strong><span>{item.prompt.slice(0, 110)}</span></span><span className={`subtle-label outcome-${item.outcome}`}>{item.outcome === 'completed' ? c('Ответ', 'Response') : item.outcome === 'failed' ? c('Ошибка', 'Error') : item.outcome === 'pending' ? c('В работе', 'In progress') : item.outcome === 'skipped' ? c('Пропуск', 'Skipped') : c('Отмена', 'Cancelled')}</span></button>)}</div>}</article>}
    {tab === 'history' && <><article className="workspace-panel"><div className="panel-heading"><h3>{c('История эфиров', 'Live history')}</h3><button className="secondary" type="button" disabled={loading || detailLoading} onClick={() => setRevision(revision + 1)}>{c('Обновить', 'Refresh')}</button></div>{loading ? <div className="workspace-empty" role="status">{c('Загружаем сессии…', 'Loading sessions…')}</div> : page?.items.length ? <><div className="session-table-wrap"><table className="session-table"><thead><tr><th>{c('Начало / персонаж', 'Started / character')}</th><th>{c('Состояние', 'State')}</th><th>{c('Сообщения', 'Messages')}</th><th>{c('Токены', 'Tokens')}</th></tr></thead><tbody>{page.items.map(session => <tr key={session.id}><td><button type="button" className="text-button" onClick={() => { setSelectedId(session.id); setMessageOffset(0); setSelectedOperation(undefined); setDetail(undefined); }}>{new Date(session.startTime).toLocaleString()}<small>{session.profileName ?? c('Архивный профиль', 'Legacy profile')} · #{session.id}</small></button></td><td>{session.legacy ? c('Архив', 'Legacy') : session.endTime ? c('Завершена', 'Ended') : c('Открыта', 'Open')}</td><td>{session.messageCount}</td><td>{session.totalTokens ?? c('Нет данных', 'No data')}</td></tr>)}</tbody></table></div><div className="pagination"><button type="button" className="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - SESSION_LIMIT))}>{c('Назад', 'Previous')}</button><span>{offset + 1}–{offset + page.items.length} / {page.total}</span><button type="button" className="secondary" disabled={offset + page.items.length >= page.total} onClick={() => setOffset(offset + SESSION_LIMIT)}>{c('Далее', 'Next')}</button></div></> : <div className="workspace-empty">{c('Сохранённых сессий пока нет. Они создаются при явном запуске эфира.', 'No saved sessions yet. Start a live session to create one.')}</div>}</article>
      {selectedId !== undefined && <article className="workspace-panel"><div className="panel-heading"><h3>{c('Сессия', 'Session')} #{selectedId}</h3><button type="button" className="text-button" onClick={() => {setSelectedId(undefined); setSelectedOperation(undefined);}}>{c('Закрыть', 'Close')}</button></div>{detailLoading ? <p role="status">{c('Загружаем диалог…', 'Loading conversation…')}</p> : detail && <><p className="hint">{c('Персонаж:', 'Character:')} {detail.session.profileName ?? c('Архив', 'Legacy')} · {c('Операций:', 'Operations:')} {detail.session.operationCount} · {c('Токены:', 'Tokens:')} {detail.session.totalTokens ?? c('Нет данных', 'No data')}</p><MessageFeed messages={detail.messages} operations={detail.operations} onSelect={setSelectedOperation} /><div className="pagination"><button className="secondary" type="button" disabled={messageOffset === 0} onClick={() => setMessageOffset(Math.max(0, messageOffset - MESSAGE_LIMIT))}>{c('Новее', 'Newer')}</button><span>{c('Смещение от новых:', 'Offset from newest:')} {messageOffset + 1}</span><button className="secondary" type="button" disabled={detail.messages.length < MESSAGE_LIMIT} onClick={() => setMessageOffset(messageOffset + MESSAGE_LIMIT)}>{c('Старее', 'Older')}</button></div>{detail.session.legacy && detail.messages.length === 0 && <p className="hint">{c('В старой версии сообщения не были привязаны к конкретной сессии. Исходная история сохранена.', 'The previous version did not associate messages with sessions. Original history is preserved.')}</p>}</>}</article>}</>}
    {operation && <article className="workspace-panel"><div className="panel-heading"><h3>{c('Подробности реплики', 'Response details')}</h3><button className="text-button" type="button" onClick={() => setSelectedOperation(undefined)}>{c('Закрыть', 'Close')}</button></div><OperationDetail operation={operation} /></article>}
    {error && <div className="workspace-banner inline-error" role="alert">{error}<button type="button" className="secondary" onClick={() => setRevision(revision + 1)}>{c('Повторить загрузку', 'Retry loading')}</button></div>}
  </div>;
}
