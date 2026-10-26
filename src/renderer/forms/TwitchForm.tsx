import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Settings } from '../../shared/types';
import { TwitchFormSchema, type TwitchFormData } from './schemas';
import { FormShell, Field, KeyField } from './FormShell';
import { useFormDraft } from './drafts';
import { api } from '../hooks/api';
import { useCopy } from '../i18n/useCopy';

interface Props { initial: Settings; onSave: (data: TwitchFormData) => Promise<void>; saving: boolean; notice?: string; }
export function TwitchForm({ initial, onSave, saving, notice }: Props) {
  const c = useCopy();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<[string, string] | null>(null);
  const [error, setError] = useState<[string, string] | null>(null);
  const fail = (e: unknown) => { const message = e instanceof Error ? e.message : String(e); setError([message, message]); };
  const defaults: TwitchFormData = { twitchUsername: initial.twitchUsername, twitchChannel: initial.twitchChannel, twitchOauthToken: initial.twitchOauthToken ? '***' : '' };
  const form = useForm<TwitchFormData>({ resolver: zodResolver(TwitchFormSchema), defaultValues: defaults });
  const draft = useFormDraft('twitch', form, defaults);
  const login = async () => {
    const auth = (window as unknown as { twitchAuth?: { login: () => Promise<{ ok: boolean; username?: string; channel?: string; token?: string; error?: string }> } }).twitchAuth;
    if (!auth) { setError(['Автоматический вход доступен в настольном приложении. Введите логин, канал и OAuth-токен вручную.', 'Automatic login is available in the desktop app. Enter your username, channel and OAuth token manually.']); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const data = await auth.login();
      if (!data.ok || !data.token) { setError(data.error ? [data.error, data.error] : ['Вход отменён.', 'Login cancelled.']); return; }
      if (data.username) form.setValue('twitchUsername', data.username, { shouldDirty: true });
      if (data.channel) form.setValue('twitchChannel', data.channel, { shouldDirty: true });
      form.setValue('twitchOauthToken', data.token, { shouldDirty: true });
      setResult(['Данные входа получены. Нажмите «Применить и подключить».', 'Login details received. Click “Apply and connect”.']);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };
  const connect = form.handleSubmit(async values => {
    setBusy(true); setError(null); setResult(null);
    try {
      await draft.submit(onSave)(values);
      await api('/api/twitch/connect', { method: 'POST', body: '{}' });
      setResult(['Запрос подключения принят. Дождитесь подтверждения Twitch на экране «Эфир». Запуск ведущей выполняется отдельно.', 'Connection requested. Wait for Twitch confirmation on the Live screen. Start the host separately.']);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  });
  const disconnect = async () => {
    setBusy(true); setError(null); setResult(null);
    try { await api('/api/twitch/disconnect', { method: 'POST', body: '{}' }); setResult(['Twitch отключён.', 'Twitch disconnected.']); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  };
  return <>
    <p className="hint">{c('Чат продолжает поступать на паузе. Подключение Twitch само по себе не запускает ведущую.', 'Chat continues arriving while paused. Connecting Twitch does not start the host.')}</p>
    <button type="button" className="secondary" disabled={busy || saving} onClick={() => void login()}>{busy ? c('Подождите…', 'Please wait…') : c('Войти через Twitch', 'Log in with Twitch')}</button>
    <FormShell form={form} draft={draft} onSave={form.handleSubmit(draft.submit(onSave))} saving={saving || busy} notice={notice}>
      <Field form={form} name="twitchUsername" label={c('Логин Twitch', 'Twitch username')} tooltip={c('Логин аккаунта, которому принадлежит OAuth-токен.', 'The username of the account that owns the OAuth token.')} />
      <Field form={form} name="twitchChannel" label={c('Канал', 'Channel')} placeholder={c('Имя канала без #', 'Channel name without #')} />
      <KeyField form={form} name="twitchOauthToken" label={c('OAuth-токен Twitch', 'Twitch OAuth token')} saved={!!initial.twitchOauthToken} />
    </FormShell>
    <div className="actions"><button type="button" disabled={busy || saving} onClick={() => void connect()}>{c('Применить и подключить', 'Apply and connect')}</button><button type="button" className="secondary" disabled={busy || saving} onClick={() => void disconnect()}>{c('Отключить Twitch', 'Disconnect Twitch')}</button></div>
    {result && <p role="status" className="connection-result">{c(...result)}</p>}
    {error && <p role="alert" className="form-error">{c('Ошибка Twitch: ', 'Twitch error: ')}{c(...error)}</p>}
  </>;
}
