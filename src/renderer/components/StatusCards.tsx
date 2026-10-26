import type { Status } from '../../shared/types';
import type { ConnectionCheck } from '../../shared/product';
import { useWorkspaceCopy } from '../pages/workspace-copy';
interface Props { status?: Status; check?: ConnectionCheck }
export function StatusCards({ status, check }: Props) {
  const c = useWorkspaceCopy();
  if (!status) return <div className="connection-cards workspace-empty" role="status">{c('Загружаем состояния…', 'Loading connection states…')}</div>;
  const llmLabels: Record<ConnectionCheck['state'], string> = {
    unconfigured: c('Не настроена', 'Not configured'), configured: c('Настроена · не проверена', 'Configured · not checked'),
    checking: c('Проверяется…', 'Checking…'), api_verified: c('Доступ к API проверен', 'API access verified'),
    response_verified: c('Ответ получен', 'Response verified'), error: c('Ошибка проверки', 'Check failed'),
  };
  const entries = [
    { name: 'Twitch', text: status.twitch === 'connected' ? c('Подключён', 'Connected') : c('Не подключён', 'Disconnected'), ok: status.twitch === 'connected' },
    { name: c('Модель', 'Model'), text: llmLabels[check?.state ?? (status.llm === 'ready' ? 'configured' : 'unconfigured')], ok: check?.state === 'response_verified' || check?.state === 'api_verified', error: check?.state === 'error', hint: check?.message },
    { name: c('Голос', 'Voice'), text: status.tts === 'speaking' ? c('Озвучивание', 'Speaking') : status.tts === 'disabled' ? c('Выключен', 'Disabled') : c('Ожидание', 'Idle'), ok: status.tts === 'speaking' },
    { name: c('Аватар', 'Avatar'), text: status.avatar === 'connected' ? c('Подключён', 'Connected') : status.avatar === 'disabled' ? c('Выключен', 'Disabled') : c('Не подключён', 'Disconnected'), ok: status.avatar === 'connected' },
  ];
  return <div className="connection-cards">{entries.map(entry => <article key={entry.name}><small>{entry.name}</small><strong className={entry.error ? 'inline-error' : entry.ok ? 'healthy' : 'neutral'}>{entry.text}</strong>{entry.hint && <p className="hint">{entry.hint}</p>}</article>)}</div>;
}
