import { useI18n } from '../i18n';
import type { Operation, RuntimeCommand, Snapshot } from '../../shared/product';

export function useWorkspaceCopy() {
  const { lang } = useI18n();
  return (ru: string, en: string) => lang === 'en' ? en : ru;
}

export function operationLabel(operation: Operation, english = false): string {
  const labels: Record<string, [string, string]> = {
    received: ['Принято', 'Received'], generating: ['Генерация ответа', 'Generating'],
    synthesizing: ['Подготовка голоса', 'Synthesizing'], queued: ['В очереди речи', 'Speech queued'],
    speaking: ['Озвучивание', 'Speaking'], finished: ['Завершено', 'Finished'],
    completed: ['Ответ получен', 'Response received'], skipped: ['Пропущено', 'Skipped'],
    cancelled: ['Отменено', 'Cancelled'], failed: ['Ошибка', 'Failed'],
  };
  const key = operation.outcome === 'pending' ? operation.stage : operation.outcome;
  return labels[key]?.[english ? 1 : 0] ?? key;
}

export function reasonLabel(reason: string | undefined, english = false): string {
  if (!reason) return '';
  const reasons: Record<string, [string, string]> = {
    not_addressed: ['Сообщение не требует ответа', 'No response requested'],
    paused: ['Ведущая на паузе', 'Host is paused'], stopped: ['Ведущая остановлена', 'Host is stopped'],
    user_pause: ['Эфир поставлен на паузу. Продолжите, когда будете готовы.', 'The live session is paused. Resume when ready.'],
    cancelled: ['Операция отменена', 'Operation cancelled'], new_run: ['Начат новый запуск', 'New run started'],
    cooldown: ['Пауза между ответами', 'Response cooldown'],
    minute_limit: ['Достигнут минутный лимит', 'Minute limit reached'],
    rate_limit: ['Достигнут минутный лимит', 'Minute limit reached'],
    busy: ['Предыдущий ответ ещё готовится', 'A response is already in progress'],
    unconfigured: ['Настройте модель в подключениях', 'Configure the model in Connections'],
    not_configured: ['Настройте модель в подключениях', 'Configure the model in Connections'],
    source_lost: ['Потеряно подключение Twitch', 'Twitch connection lost'],
    twitch_lost: ['Потеряно подключение Twitch', 'Twitch connection lost'],
    player_lost: ['Потеряно подключение аудиоплеера', 'Audio player disconnected'],
    audio_lost: ['Потеряно подключение аудиоплеера', 'Audio player disconnected'],
    interrupted: ['Реплика прервана', 'Response interrupted'],
    profile_changed: ['Профиль изменён', 'Profile changed'],
    muted: ['Звук выключен', 'Muted'],
  };
  return reasons[reason]?.[english ? 1 : 0] ?? reason;
}

export function commandBlockReason(snapshot: Snapshot, command: RuntimeCommand, connected: boolean, busy: boolean, english = false): string {
  if (!connected) return english ? 'Waiting for the app connection' : 'Ожидается связь с приложением';
  if (busy) return english ? 'Wait for the current command' : 'Дождитесь выполнения команды';
  if (command === 'start' || command === 'resume') {
    if (!snapshot.settings.llmApiKey || !snapshot.settings.llmModel) return english ? 'Configure the model in Connections' : 'Настройте модель в «Подключениях»';
    if (snapshot.status.twitch !== 'connected') return english ? 'Connect Twitch first; local tests work without it' : 'Подключите Twitch; локальный тест работает без него';
  }
  return '';
}

export function formatDuration(ms: number | undefined, english = false): string {
  if (ms === undefined) return english ? 'No data' : 'Нет данных';
  return ms < 1000 ? `${Math.round(ms)} ${english ? 'ms' : 'мс'}` : `${(ms / 1000).toFixed(1)} ${english ? 's' : 'с'}`;
}
