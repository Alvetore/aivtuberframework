import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FeedMessage, Operation, RuntimeCommand, Snapshot } from '../../shared/product';
import { StatusCards } from '../components/StatusCards';
import { ChatTester } from '../components/ChatTester';
import { Onboarding } from './Onboarding';
import { commandBlockReason, formatDuration, operationLabel, reasonLabel, useWorkspaceCopy } from './workspace-copy';
import './workspace.css';

export interface LivePageProps {
  snapshot: Snapshot; connected: boolean; busy: boolean; error: string;
  onCommand: (command: RuntimeCommand) => Promise<void>;
  onTest: (text: string) => Promise<{operationId: string}>;
  avatarPreview?: ReactNode;
  onNavigate: (section: string) => void;
}

export function MessageFeed({ messages, operations = [], onSelect }: {messages: FeedMessage[]; operations?: Operation[]; onSelect?: (id: string) => void}) {
  const c = useWorkspaceCopy();
  const list = useRef<HTMLOListElement>(null);
  const follow = useRef(true);
  const [hasNew, setHasNew] = useState(false);
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    if (follow.current && list.current) list.current.scrollTop = list.current.scrollHeight;
    else if (lastId) setHasNew(true);
  }, [lastId]);
  if (messages.length === 0) return <div className="workspace-empty"><strong>{c('Здесь начнётся разговор', 'The conversation starts here')}</strong><p>{c('Подключите Twitch или отправьте локальное тестовое сообщение ниже.', 'Connect Twitch or send a local test message below.')}</p></div>;
  return <><ol ref={list} onScroll={() => { const node = list.current; if (!node) return; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 50; if (follow.current) setHasNew(false); }} className="message-feed" aria-label={c('Чат и ответы', 'Chat and responses')}>
    {messages.map(message => {
      const repliedTo = messages.find(item => item.id === message.replyToId);
      const operation = operations.find(item => item.id === message.operationId || item.messageId === message.id);
      return <li className={`feed-message ${message.isBotResponse ? 'bot' : ''}`} key={message.id} id={`message-${message.id}`}>
        <div className="feed-meta"><strong>{message.username}</strong><time dateTime={message.timestamp}>{new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</time><span className="subtle-label">{message.source === 'test' ? c('Тест', 'Test') : message.source === 'legacy' ? c('Архив', 'Legacy') : 'Twitch'}</span></div>
        {message.replyToId && <a className="reply-link" href={`#message-${message.replyToId}`}>{c('Ответ', 'Reply')} {repliedTo ? `${c('для', 'to')} ${repliedTo.username}: ${repliedTo.message.slice(0, 90)}` : c('на предыдущее сообщение', 'to an earlier message')}</a>}
        <p>{message.message}</p>
        {operation && <button className={`operation-link outcome-${operation.outcome}`} type="button" onClick={() => onSelect?.(operation.id)}>{operationLabel(operation, c('ru', 'en') === 'en')}{operation.reason ? ` · ${reasonLabel(operation.reason, c('ru', 'en') === 'en')}` : ''}</button>}
      </li>;
    })}
  </ol>{hasNew && <button type="button" className="new-messages-button secondary" onClick={() => {if (list.current) list.current.scrollTop = list.current.scrollHeight;follow.current=true;setHasNew(false);}}>{c('Новые сообщения ↓', 'New messages ↓')}</button>}</>;
}

export function OperationDetail({ operation }: {operation: Operation}) {
  const c = useWorkspaceCopy();
  const en = c('ru', 'en') === 'en';
  return <div className="operation-detail">
    <span className={`state-badge outcome-${operation.outcome}`}>{operationLabel(operation, en)}</span>
    <p className="hint">{operation.trigger==='idle'?c('Инициатива ведущей','Host initiative'):operation.source === 'test' ? c('Локальный тест', 'Local test') : 'Twitch'} · {operation.author}</p>
    {operation.reason && <p>{reasonLabel(operation.reason, en)}</p>}
    {operation.error && <p className="inline-error" role="alert">{operation.error}</p>}
    {operation.retryAfterMs !== undefined && operation.outcome === 'skipped' && <p className="hint">{c('Ожидание на момент решения:', 'Wait at decision time:')} {formatDuration(operation.retryAfterMs, en)}</p>}
    <dl className="metrics-grid"><div><dt>{c('Ответ модели', 'Model latency')}</dt><dd>{formatDuration(operation.llmMs, en)}</dd></div><div><dt>{c('Синтез голоса', 'Voice synthesis')}</dt><dd>{formatDuration(operation.synthesisMs, en)}</dd></div><div><dt>{c('Воспроизведение', 'Playback')}</dt><dd>{formatDuration(operation.playbackMs, en)}</dd></div><div><dt>{c('Попытки API', 'API attempts')}</dt><dd>{operation.attempts ?? c('Нет данных', 'No data')}</dd></div><div><dt>{c('Токены запроса', 'Input tokens')}</dt><dd>{operation.usage?.promptTokens ?? c('Нет данных', 'No data')}</dd></div><div><dt>{c('Токены ответа', 'Output tokens')}</dt><dd>{operation.usage?.completionTokens ?? c('Нет данных', 'No data')}</dd></div></dl>
    <details><summary>{c('Идентификаторы и время', 'Identifiers and timing')}</summary><p className="mono">{operation.id}</p><p>{new Date(operation.createdAt).toLocaleString()}</p>{operation.finishedAt && <p>{new Date(operation.finishedAt).toLocaleString()}</p>}</details>
  </div>;
}

export function LivePage({ snapshot, connected, busy, error, onCommand, onTest, avatarPreview, onNavigate }: LivePageProps) {
  const c = useWorkspaceCopy();
  const en = c('ru', 'en') === 'en';
  const [selectedId, setSelectedId] = useState<string>();
  const [commandError, setCommandError] = useState('');
  const [showSetup, setShowSetup] = useState(!snapshot.settings.llmApiKey);
  const [now, setNow] = useState(Date.now());
  const [clock, setClock] = useState({ server: snapshot.serverTime, local: Date.now() });
  useEffect(() => { setClock({server: snapshot.serverTime, local: Date.now()}); }, [snapshot.serverTime]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const pending = snapshot.operations.find(op => op.outcome === 'pending');
  const selected = snapshot.operations.find(op => op.id === selectedId) ?? pending;
  const state = snapshot.runtime.state;
  const command: RuntimeCommand = state === 'running' ? 'pause' : state === 'paused' ? 'resume' : 'start';
  const blocked = commandBlockReason(snapshot, command, connected, busy, en);
  const invoke = async (action: RuntimeCommand) => { setCommandError(''); try { await onCommand(action); } catch (e) { setCommandError((e as Error).message); } };
  const cooldown = Math.max(0, Math.ceil((snapshot.runtime.cooldownUntil - (clock.server + now - clock.local)) / 1000));
  return <div className="live-workspace">
    {showSetup && <Onboarding snapshot={snapshot} onNavigate={onNavigate} onDismiss={() => setShowSetup(false)} />}
    {!connected && <div className="workspace-banner" role="status">{c('Связь с приложением потеряна. Восстанавливаем подключение; локальный звук остановлен.', 'App connection lost. Reconnecting; local audio is stopped.')}</div>}
    <div className="runtime-strip">
      <div><span className="eyebrow">{c('Ведущая', 'Host')}</span><strong className={`runtime-state state-${state}`}><i aria-hidden="true" />{state === 'running' ? c('В эфире', 'Live') : state === 'paused' ? c('На паузе', 'Paused') : c('Остановлена', 'Stopped')}</strong><span className="hint">{snapshot.settings.characterName} · {snapshot.settings.mode === 'reactive' ? c('Ответы зрителям', 'Reactive') : c('Ведёт разговор', 'Streamer')}</span></div>
      <div className="runtime-actions"><button type="button" onClick={() => void invoke(command)} disabled={Boolean(blocked)}>{command === 'start' ? c('Начать эфир', 'Start live') : command === 'resume' ? c('Продолжить', 'Resume') : c('Пауза', 'Pause')}</button><button className="secondary" type="button" disabled={!connected || busy || state === 'stopped'} onClick={() => void invoke('stop')}>{c('Стоп', 'Stop')}</button><button className="secondary" type="button" disabled={!connected || busy || (!pending && snapshot.queue.state === 'idle')} onClick={() => void invoke('interrupt')}>{c('Прервать реплику', 'Interrupt')}</button><button className="secondary" type="button" aria-pressed={snapshot.runtime.muted} disabled={!connected || busy} onClick={() => void invoke(snapshot.runtime.muted ? 'unmute' : 'mute')}>{snapshot.runtime.muted ? c('Включить звук', 'Unmute') : c('Выключить звук', 'Mute')}</button></div>
    </div>
    {blocked && <p className="hint command-hint">{blocked}{snapshot.status.twitch !== 'connected' && <button className="text-button" onClick={() => onNavigate('connections')}>{c('Открыть подключения', 'Open connections')}</button>}</p>}
    {snapshot.runtime.reason && <div className="workspace-banner">{reasonLabel(snapshot.runtime.reason, en)}</div>}
    {(error || commandError) && <p className="inline-error" role="alert">{error || commandError}</p>}
    <StatusCards status={snapshot.status} check={snapshot.checks.llm} />
    <div className="live-grid"><article className="workspace-panel feed-panel"><div className="panel-heading"><h3>{c('Разговор', 'Conversation')}</h3><span className="subtle-label">{c('Последние сообщения', 'Recent messages')}</span></div><MessageFeed messages={snapshot.feed} operations={snapshot.operations} onSelect={setSelectedId} /></article>
      <div className="live-side"><article className="workspace-panel avatar-panel"><div className="panel-heading"><h3>{c('Аватар', 'Avatar')}</h3><button type="button" className="text-button" onClick={() => onNavigate('avatar')}>{c('Настроить', 'Configure')}</button></div><div className="live-avatar-preview">{avatarPreview ?? <div className="workspace-empty">{c('Добавьте аватар или работайте только с голосом.', 'Add an avatar or use voice only.')}</div>}</div></article>
      <article className="workspace-panel"><h3>{c('Сейчас', 'Now')}</h3><p className="current-action">{pending ? operationLabel(pending, en) : snapshot.queue.state === 'speaking' ? c('Озвучивание', 'Speaking') : snapshot.runtime.muted ? c('Звук выключен · текстовые ответы активны', 'Muted · text responses remain active') : state === 'running' ? c('Слушает чат', 'Listening to chat') : c('Ожидание запуска или теста', 'Waiting for start or test')}</p><p className="hint">{c('В очереди речи:', 'Speech queue:')} <b>{snapshot.queue.pending}</b>{cooldown > 0 && <> · {c('Пауза:', 'Cooldown:')} {cooldown} {c('с', 's')}</>}</p>{snapshot.queue.text && <p className="queue-text">{snapshot.queue.text}</p>}</article></div>
    </div>
    <ChatTester key={`${snapshot.serverInstanceId}:${snapshot.runtime.profileId}`} onTest={onTest} operations={snapshot.operations} disabled={!connected || busy || state === 'running'} disabledReason={state === 'running' ? c('Поставьте эфир на паузу, чтобы провести тест.', 'Pause the live session to run a test.') : !connected ? c('Ожидается связь с приложением.', 'Waiting for app connection.') : undefined} />
    {selected && <article className="workspace-panel"><div className="panel-heading"><h3>{c('Подробности реплики', 'Response details')}</h3>{selectedId && <button className="text-button" type="button" onClick={() => setSelectedId(undefined)}>{c('Закрыть', 'Close')}</button>}</div><OperationDetail operation={selected} /></article>}
    <button type="button" className="text-button setup-link" onClick={() => setShowSetup(!showSetup)}>{c('Мастер настройки', 'Setup guide')}</button>
  </div>;
}
