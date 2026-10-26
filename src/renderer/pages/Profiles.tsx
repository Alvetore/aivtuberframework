import { useEffect, useRef, useState } from 'react';
import { ProfileFileSchema, type Snapshot } from '../../shared/product';
import { api } from '../hooks/api';
import { useDrafts } from '../forms/drafts';
import { useCopy } from '../i18n/useCopy';

export function Profiles({ snapshot, onChanged }: { snapshot: Snapshot; onChanged: () => Promise<void> }) {
  const c = useCopy();
  const [selected, setSelected] = useState(snapshot.runtime.profileId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<[string, string] | null>(null);
  const [result, setResult] = useState<[string, string] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const drafts = useDrafts();
  const running = snapshot.runtime.state === 'running';
  const profile = snapshot.profiles.find(item => item.id === selected);
  useEffect(() => { setSelected(snapshot.runtime.profileId); }, [snapshot.runtime.profileId]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null); setResult(null);
    try { await work(); await onChanged(); }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const translated: Record<string, string> = {
        'Файл профиля слишком большой (максимум 1 МБ).': 'Profile file is too large (maximum 1 MB).',
        'Неверный формат профиля или неподдерживаемая версия. Изменения не внесены.': 'Invalid profile format or unsupported version. No changes were made.',
      };
      setError([message, translated[message] ?? message]);
    }
    finally { setBusy(false); }
  };
  const select = async () => {
    if (!profile || selected === snapshot.runtime.profileId) return;
    if (drafts.hasPendingSaves()) { setError(['Дождитесь применения настроек перед сменой профиля.', 'Wait for settings to finish applying before changing profiles.']); return; }
    if (drafts.hasDirtyDrafts() && !window.confirm(c('В формах есть неприменённые изменения. Сменить профиль и отменить эти черновики?', 'There are unsaved form changes. Switch profiles and discard these drafts?'))) return;
    await run(async () => {
      await api(`/api/profiles/${encodeURIComponent(selected)}/select`, { method: 'POST', body: '{}' });
      drafts.discardAllDrafts();
      setResult([`Выбран профиль «${profile.name}».`, `Profile “${profile.name}” selected.`]);
    });
  };
  const create = async () => run(async () => {
    await api('/api/profiles', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    setName(''); setResult(['Профиль создан. Выберите его в списке, чтобы начать настройку.', 'Profile created. Select it in the list to start configuring it.']);
  });
  const rename = async () => run(async () => {
    await api(`/api/profiles/${encodeURIComponent(selected)}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
    setName(''); setResult(['Имя профиля изменено.', 'Profile renamed.']);
  });
  const duplicate = async () => run(async () => {
    await api(`/api/profiles/${encodeURIComponent(selected)}/duplicate`, { method: 'POST', body: '{}' });
    setResult(['Копия настроек создана без истории и сессий.', 'Settings duplicated without history or sessions.']);
  });
  const exportProfile = async () => run(async () => {
    const data = ProfileFileSchema.parse(await api(`/api/profiles/${encodeURIComponent(selected)}/export`));
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${data.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'profile'}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setResult(['Экспортирован профиль без ключей, подключений, устройств и пути модели.', 'Profile exported without keys, connections, devices or the model path.']);
  });
  const importProfile = async (file: File | undefined) => {
    if (!file) return;
    await run(async () => {
      if (file.size > 1_000_000) throw new Error('Файл профиля слишком большой (максимум 1 МБ).');
      let data: unknown;
      try { data = ProfileFileSchema.parse(JSON.parse(await file.text())); }
      catch { throw new Error('Неверный формат профиля или неподдерживаемая версия. Изменения не внесены.'); }
      await api('/api/profiles/import', { method: 'POST', body: JSON.stringify(data) });
      setResult(['Профиль импортирован. Выберите его явно; файл модели потребуется привязать заново.', 'Profile imported. Select it explicitly and bind its model file again.']);
    });
    if (input.current) input.current.value = '';
  };
  return <article className="profile-bar">
    <h3>{c('Профиль персонажа', 'Character profile')}</h3>
    <div className="profile-controls">
      <label>{c('Профиль', 'Profile')}<select value={selected} onChange={event => setSelected(event.target.value)} disabled={busy || running}>{snapshot.profiles.map(item => <option key={item.id} value={item.id}>{item.name}{item.id === snapshot.runtime.profileId ? c(' · активный', ' · active') : ''}</option>)}</select></label>
      <button type="button" onClick={() => void select()} disabled={busy || running || selected === snapshot.runtime.profileId || !profile}>{c('Выбрать', 'Select')}</button>
      <button type="button" className="secondary" onClick={() => void duplicate()} disabled={busy || running || !profile}>{c('Дублировать', 'Duplicate')}</button>
    </div>
    {running && <p className="hint">{c('Для смены и настройки профилей поставьте ведущую на паузу.', 'Pause the host before changing or configuring profiles.')}</p>}
    <details><summary>{c('Создать, переименовать, перенести профиль', 'Create, rename or transfer a profile')}</summary>
      <div className="profile-controls"><label>{c('Имя профиля', 'Profile name')}<input value={name} maxLength={64} placeholder={c('Имя нового профиля или новое имя выбранного', 'Name for a new profile or a new name for the selected one')} onChange={event => setName(event.target.value)} disabled={busy || running} /></label><button type="button" disabled={busy || running || !name.trim()} onClick={() => void create()}>{c('Создать', 'Create')}</button><button type="button" className="secondary" disabled={busy || running || !name.trim() || !profile} onClick={() => void rename()}>{c('Переименовать', 'Rename')}</button></div>
      <div className="profile-file-actions"><button type="button" className="secondary" disabled={busy || !profile} onClick={() => void exportProfile()}>{c('Экспорт JSON', 'Export JSON')}</button><label className="file-picker">{c('Импорт JSON', 'Import JSON')}<input ref={input} type="file" accept="application/json,.json" disabled={busy || running} onChange={event => void importProfile(event.target.files?.[0])} /></label></div>
      <p className="hint">{c('Профиль содержит характер, поведение, голос и оформление аватара. Ключи и подключения общие. Новые и дублированные профили начинают со своей историей.', 'Profiles contain personality, behaviour, voice and avatar appearance. Keys and connections are shared. New and duplicated profiles start with their own history.')}</p>
    </details>
    {busy && <p role="status">{c('Выполняется…', 'Working…')}</p>}{result && <p role="status" className="connection-result">{c(...result)}</p>}{error && <p role="alert" className="form-error">{c(...error)}</p>}
  </article>;
}
