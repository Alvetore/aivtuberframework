import { useState } from 'react';
import type { LogEntry } from '../../shared/types';
import { useWorkspaceCopy } from '../pages/workspace-copy';
export function filterLogs(logs: LogEntry[], level: string, source: string, query: string): LogEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  return logs.filter(log => (level === 'all' || log.level === level) && (source === 'all' || log.source === source) && (!normalized || `${log.source} ${log.message}`.toLocaleLowerCase().includes(normalized)));
}
export function LogsView({ logs }: {logs: LogEntry[]}) {
  const c = useWorkspaceCopy();
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const [source, setSource] = useState('all');
  const sources = [...new Set(logs.map(log => log.source))].sort();
  const filtered = filterLogs(logs, level, source, query);
  return <div className="diagnostic-logs"><div className="log-filters"><label>{c('Поиск', 'Search')}<input type="search" placeholder={c('По сообщению или источнику', 'Message or source')} value={query} onChange={event => setQuery(event.target.value)} /></label><label>{c('Уровень', 'Level')}<select value={level} onChange={event => setLevel(event.target.value)}><option value="all">{c('Все', 'All')}</option><option value="error">{c('Ошибки', 'Errors')}</option><option value="info">{c('События', 'Events')}</option></select></label><label>{c('Источник', 'Source')}<select value={source} onChange={event => setSource(event.target.value)}><option value="all">{c('Все источники', 'All sources')}</option>{sources.map(item => <option key={item}>{item}</option>)}</select></label></div><p className="hint">{c('Поиск по загруженным событиям:', 'Search loaded events:')} {filtered.length}/{logs.length}. {c('После ошибки проверьте соответствующее подключение или настройки.', 'After an error, check the corresponding connection or settings.')}</p>
    {filtered.length === 0 ? <div className="workspace-empty">{logs.length === 0 ? c('Событий пока нет.', 'No events yet.') : c('Ничего не найдено. Измените фильтры.', 'No matches. Adjust the filters.')}</div> : <ol className="event-log">{filtered.map(log => <li key={log.id} className={log.level}><div><time dateTime={log.time}>{new Date(log.time).toLocaleTimeString()}</time><strong>{log.source}</strong><span className="subtle-label">{log.level === 'error' ? c('Ошибка', 'Error') : c('Событие', 'Event')}</span></div><p>{log.message}</p></li>)}</ol>}
  </div>;
}
