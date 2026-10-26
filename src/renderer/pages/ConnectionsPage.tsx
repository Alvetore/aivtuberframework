import type { Settings } from '../../shared/types';
import { LlmForm } from '../forms/LlmForm';
import { TwitchForm } from '../forms/TwitchForm';
import { useCopy } from '../i18n/useCopy';

interface Props { initial: Settings; onSave: (data: Partial<Settings>) => Promise<void>; saving: boolean; notice?: string; }
export function ConnectionsPage({ initial, onSave, saving, notice }: Props) {
  const c = useCopy();
  return <div className="connection-page">
    <article className="connection-card"><h3>{c('Модель и API', 'Model and API')}</h3><LlmForm initial={initial} onSave={onSave} saving={saving} notice={notice} /></article>
    <article className="connection-card"><h3>{c('Чат Twitch', 'Twitch chat')}</h3><TwitchForm initial={initial} onSave={onSave} saving={saving} notice={notice} /></article>
  </div>;
}
