import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { UseFormReturn, FieldValues, Path } from 'react-hook-form';
import type { FormDraft } from './drafts';
import { useCopy } from '../i18n/useCopy';
import './settings.css';

interface BaseProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  onSave: () => Promise<void> | void;
  saving: boolean;
  notice?: string;
  children: ReactNode;
  draft?: FormDraft<T>;
}

export function FormShell<T extends FieldValues>({ form, onSave, saving, notice, children, draft }: BaseProps<T>) {
  const c = useCopy();
  const [error, setError] = useState('');
  const save = async () => { if (saving || (draft && !draft.dirty)) return; setError(''); try { await onSave(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        const element = document.activeElement;
        if (element && !element.closest('form')?.isSameNode(formElement.current)) return;
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSave]);
  const formElement = useRef<HTMLFormElement>(null);
  return (
    <form ref={formElement} onSubmit={(e) => { e.preventDefault(); void save(); }} className="settings-form">
      <fieldset className="form-fields" disabled={saving}>{children}</fieldset>
      <div className="actions">
        <button type="submit" disabled={saving || (draft ? !draft.dirty : false)}>{saving ? c('Применение…', 'Applying…') : c('Применить', 'Apply')}</button>
        {draft && <button type="button" className="secondary" disabled={saving || !draft.dirty} onClick={() => { draft.discard(); setError(''); }}>{c('Отменить изменения', 'Discard changes')}</button>}
        {draft?.dirty && <span className="draft-state">{c('Есть изменения', 'Unsaved changes')}</span>}
      </div>
      {error ? <p className="form-error" role="alert">{c('Не удалось применить: ', 'Unable to apply: ')}{validationText(error, c)}</p> : notice && <p className="notice" role="status">{notice}</p>}
    </form>
  );
}

export function Tooltip({ title, text }: { title?: string; text?: string }) {
  if (!text) return null;
  return (
    <div className="field-help">
      {title && <strong>{title}</strong>}
      <span>{text}</span>
    </div>
  );
}

interface FieldProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  type?: 'text' | 'password' | 'number' | 'textarea';
  rows?: number;
  placeholder?: string;
  tooltip?: string;
}

export function Field<T extends FieldValues>({ form, name, label, type = 'text', rows, placeholder, tooltip }: FieldProps<T>) {
  const c = useCopy();
  const { register, formState: { errors } } = form;
  const error = errors[name]?.message as string | undefined;
  return (
    <div className="field-wrapper">
      <label className="field">
        <div className="field-label-row">
          <span>{label}</span>
        </div>
        {type === 'textarea' ? (
          <textarea rows={rows ?? 3} {...register(name)} placeholder={placeholder} className={error ? 'error' : ''} aria-invalid={!!error} />
        ) : (
          <input type={type} step={type === 'number' ? 'any' : undefined} {...register(name)} placeholder={placeholder} className={error ? 'error' : ''} aria-invalid={!!error} />
        )}
        {error && <em className="error">{validationText(error, c)}</em>}
      </label>
      {tooltip && <Tooltip title={label} text={tooltip} />}
    </div>
  );
}

interface SelectProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  options: { value: string | number; label: string }[];
  tooltip?: string;
}

export function Select<T extends FieldValues>({ form, name, label, options, tooltip }: SelectProps<T>) {
  const c = useCopy();
  const { register } = form;
  const error = form.formState.errors[name]?.message as string | undefined;
  return (
    <div className="field-wrapper">
      <label className="field">
        <div className="field-label-row">
          <span>{label}</span>
        </div>
        <select {...register(name)} aria-invalid={!!error}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {error && <em className="error">{validationText(error, c)}</em>}
      </label>
      {tooltip && <Tooltip title={label} text={tooltip} />}
    </div>
  );
}

interface CheckboxProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  tooltip?: string;
}

export function Checkbox<T extends FieldValues>({ form, name, label, tooltip }: CheckboxProps<T>) {
  const { register } = form;
  return (
    <div className="field-wrapper">
      <label className="field-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
        <input type="checkbox" {...register(name)} style={{ width: 'auto', margin: 0 }} />
        <span>{label}</span>
      </label>
      {tooltip && <Tooltip title={label} text={tooltip} />}
    </div>
  );
}

export function KeyField<T extends FieldValues>({ form, name, label, saved }: { form: UseFormReturn<T>; name: Path<T>; label: string; saved: boolean }) {
  const c = useCopy();
  const [replacing, setReplacing] = useState(false);
  const value = String(form.watch(name) ?? '');
  const preserved = value === '***';
  const removed = saved && !value && !replacing;
  const set = (next: string) => form.setValue(name, next as never, { shouldDirty: true });
  useEffect(() => { if (preserved) setReplacing(false); }, [preserved]);
  return <div className="key-field">
    <label className="field"><span>{label}</span>
      {(replacing || (!saved && !preserved)) && <input type="password" autoComplete="new-password" value={preserved ? '' : value} onChange={event => set(event.target.value)} placeholder={c('Введите новый ключ', 'Enter a new key')} aria-label={label} />}
    </label>
    <div className="key-actions">
      <span className="key-state">{removed ? c('Ключ будет удалён после применения', 'Key will be deleted when you apply') : preserved ? c('Ключ сохранён', 'Key saved') : value ? c('Новый ключ — требуется применить', 'New key — apply to save') : c('Ключ не задан', 'No key configured')}</span>
      {(saved || preserved) && !replacing && <button type="button" className="secondary" onClick={() => { setReplacing(true); if (!value) set('***'); }}>{c('Заменить', 'Replace')}</button>}
      {(saved || value) && <button type="button" className="secondary" onClick={() => { set(''); setReplacing(false); }}>{c('Удалить', 'Delete')}</button>}
      {saved && !preserved && <button type="button" className="secondary" onClick={() => { set('***'); setReplacing(false); }}>{c('Оставить сохранённый', 'Keep saved key')}</button>}
    </div>
  </div>;
}

export function validationText(error: string, c: (ru: string, en: string) => string) {
  const messages: Record<string, string> = {
    'Имя обязательно': 'Name is required', 'Слишком длинное описание': 'Description is too long',
    'Некорректный URL endpoint': 'Enter a valid API URL', 'Модель обязательна': 'Model is required',
    'Логин обязателен': 'Username is required', 'Канал обязателен': 'Channel is required',
  };
  return c(error, messages[error] ?? error);
}
