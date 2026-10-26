import { useState } from 'react';
import type { Snapshot } from '../../shared/product';
import { useWorkspaceCopy } from './workspace-copy';

interface Props { snapshot: Snapshot; onNavigate: (section: string) => void; onDismiss?: () => void }
export function Onboarding({ snapshot, onNavigate, onDismiss }: Props) {
  const c = useWorkspaceCopy();
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState<number[]>([]);
  const steps = [
    { title: c('Персонаж', 'Character'), section: 'character', optional: false, done: Boolean(snapshot.settings.characterName), body: c('Задайте имя, характер и манеру общения. Для первого теста подойдут текущие настройки.', 'Set the name, personality and response style. Current settings work for a first test.'), action: c('Настроить персонажа', 'Set up character') },
    { title: c('Модель', 'Model'), section: 'connections', optional: false, done: Boolean(snapshot.settings.llmApiKey && snapshot.settings.llmModel), body: c('Укажите адрес API, ключ и модель. Сохранение не отправляет платный запрос; проверка запускается отдельно.', 'Set the API endpoint, key and model. Saving does not make a paid request; run checks explicitly.'), action: c('Подключить модель', 'Connect model') },
    { title: c('Голос', 'Voice'), section: 'tts', optional: true, done: !snapshot.settings.ttsEnabled || Boolean(snapshot.settings.ttsVoice), body: c('Выберите голос и громкость, затем прослушайте образец. Можно начать с текстовых ответов.', 'Choose a voice and volume, then listen to a sample. You can start with text responses.'), action: c('Выбрать и прослушать', 'Choose and preview') },
    { title: c('Аватар', 'Avatar'), section: 'avatar', optional: true, done: snapshot.status.avatar === 'connected', body: c('Добавьте Live2D или подключите VTube Studio. Аватар необязателен: ведущая может работать только с голосом.', 'Add Live2D or connect VTube Studio. An avatar is optional; voice-only hosting is supported.'), action: c('Настроить аватар', 'Set up avatar') },
    { title: 'Twitch', section: 'connections', optional: true, done: snapshot.status.twitch === 'connected', body: c('Подключите канал для эфира. Локальный диалог можно проверить без Twitch; мастер сам не запускает ведущую.', 'Connect a channel for live hosting. Test a local conversation without Twitch; this guide never starts the host automatically.'), action: c('Подключить канал', 'Connect channel') },
  ];
  const current = steps[step];
  return <article className="onboarding workspace-panel" aria-label={c('Мастер настройки', 'Setup guide')}>
    <div className="panel-heading"><div><span className="eyebrow">{c('Первый запуск', 'Getting started')}</span><h3>{c('Подготовим вашу ведущую', 'Prepare your host')}</h3></div>{onDismiss && <button className="text-button" type="button" onClick={onDismiss}>{c('Свернуть', 'Collapse')}</button>}</div>
    <ol className="setup-steps">{steps.map((item, index) => <li key={item.title}><button type="button" className={index === step ? 'active' : ''} aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}><span>{item.done ? '✓' : skipped.includes(index) ? '−' : index + 1}</span>{item.title}</button></li>)}</ol>
    <div className="setup-body"><div><h4>{current.title}{current.optional && <span className="subtle-label"> · {c('Необязательно', 'Optional')}</span>}</h4><p>{current.body}</p><p className="hint">{current.done ? c('Настройки есть. Проверьте их, когда будете готовы.', 'Settings are present. Verify them when you are ready.') : c('Этот шаг ещё не настроен.', 'This step has not been configured yet.')}</p></div><button type="button" className="secondary" onClick={() => onNavigate(current.section)}>{current.action}</button></div>
    <div className="setup-actions"><button type="button" className="text-button" disabled={step === 0} onClick={() => setStep(step - 1)}>{c('Назад', 'Back')}</button>{current.optional && step < 4 && <button className="text-button" type="button" onClick={() => { setSkipped([...skipped, step]); setStep(step + 1); }}>{c('Пропустить', 'Skip')}</button>}{step < 4 ? <button type="button" onClick={() => setStep(step + 1)}>{c('Далее', 'Next')}</button> : <button type="button" onClick={() => { onDismiss?.(); onNavigate('live'); }}>{c('К локальному тесту', 'Open local test')}</button>}</div>
  </article>;
}
