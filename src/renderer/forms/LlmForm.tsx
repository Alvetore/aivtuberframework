import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Settings } from '../../shared/types';
import { LlmFormSchema, type LlmFormData } from './schemas';
import { FormShell, Field, KeyField, validationText } from './FormShell';
import { useFormDraft } from './drafts';
import { api } from '../hooks/api';
import { useCopy } from '../i18n/useCopy';

interface Props { initial: Settings; onSave: (data: LlmFormData) => Promise<void>; saving: boolean; notice?: string; }
const providers = [
  { name: 'Свой совместимый API', en: 'Custom compatible API', endpoint: '' },
  { name: 'OpenAI', endpoint: 'https://api.openai.com/v1' },
  { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1' },
  { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1' },
  { name: 'Локальный API', en: 'Local API', endpoint: 'http://127.0.0.1:1234/v1' },
];
export function LlmForm({ initial, onSave, saving, notice }: Props) {
  const c = useCopy();
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<[string, string] | null>(null);
  const [error, setError] = useState('');
  const defaults: LlmFormData = { llmEndpoint: initial.llmEndpoint, llmApiKey: initial.llmApiKey ? '***' : '', llmModel: initial.llmModel, temperature: initial.temperature, maxTokens: initial.maxTokens };
  const form = useForm<LlmFormData>({ resolver: zodResolver(LlmFormSchema), defaultValues: defaults });
  const draft = useFormDraft('llm', form, defaults);
  const endpoint = form.watch('llmEndpoint');
  const apiKey = form.watch('llmApiKey');
  useEffect(() => { setResult(null); setError(''); setModels([]); }, [endpoint, apiKey]);
  const fetchModels = async () => {
    setChecking(true); setResult(null); setError('');
    const checked = { endpoint: form.getValues('llmEndpoint'), apiKey: form.getValues('llmApiKey') };
    try {
      const data = await api<{ models: string[] }>('/api/llm/models', { method: 'POST', body: JSON.stringify(checked), timeoutMs: 15000 });
      if (checked.endpoint !== form.getValues('llmEndpoint') || checked.apiKey !== form.getValues('llmApiKey')) return;
      setModels(data.models);
      setResult([`Доступ к списку моделей проверен. Получено: ${data.models.length}. Для проверки генерации отправьте тестовое сообщение на экране «Эфир».`, `Model listing verified. Found: ${data.models.length}. Send a test message on the Live screen to verify generation.`]);
    } catch (e) { if (checked.endpoint === form.getValues('llmEndpoint') && checked.apiKey === form.getValues('llmApiKey')) setError((e as Error).message); }
    finally { setChecking(false); }
  };
  return <FormShell form={form} draft={draft} onSave={form.handleSubmit(draft.submit(onSave))} saving={saving} notice={notice}>
    <p className="hint">{c('Подключение к модели общее для всех персонажей. Проверки запускаются только по вашей кнопке.', 'All characters share this model connection. Checks run only when you request them.')}</p>
    <label className="field">{c('Провайдер', 'Provider')}
      <select value={providers.find(provider => provider.endpoint === form.watch('llmEndpoint'))?.endpoint ?? ''} onChange={event => form.setValue('llmEndpoint', event.target.value, { shouldDirty: true })}>
        {providers.map(provider => <option key={provider.name} value={provider.endpoint}>{c(provider.name, provider.en ?? provider.name)}</option>)}
      </select>
    </label>
    <Field form={form} name="llmEndpoint" label={c('Адрес API', 'API URL')} placeholder="https://api.openai.com/v1" tooltip={c('Совместимый с OpenAI адрес без /chat/completions. Пресет меняет только адрес; модель выберите самостоятельно.', 'OpenAI-compatible base URL without /chat/completions. A preset changes only the URL; choose the model yourself.')} />
    <KeyField form={form} name="llmApiKey" label={c('API-ключ модели', 'Model API key')} saved={!!initial.llmApiKey} />
    <label className="field">{c('Модель', 'Model')}
      <input list="llm-models-list" {...form.register('llmModel')} placeholder={c('Введите идентификатор модели', 'Enter a model ID')} aria-invalid={!!form.formState.errors.llmModel} />
      <datalist id="llm-models-list">{models.map(model => <option key={model} value={model} />)}</datalist>
      {form.formState.errors.llmModel?.message && <em className="error">{validationText(form.formState.errors.llmModel.message, c)}</em>}
    </label>
    <div><button type="button" className="secondary" disabled={checking || saving} onClick={() => void fetchModels()}>{checking ? c('Проверка доступа…', 'Checking access…') : c('Проверить доступ и получить модели', 'Check access and list models')}</button><p className="connection-action-note">{c('Использует введённый адрес и ключ. Список моделей не подтверждает успешную генерацию.', 'Uses the URL and key entered above. Listing models does not verify generation.')}</p></div>
    {result && <p role="status" className="connection-result">{c(...result)}</p>}
    {error && <p role="alert" className="form-error">{c('Ошибка проверки доступа: ', 'Access check failed: ')}{error}</p>}
    <details><summary>{c('Дополнительные параметры', 'Advanced settings')}</summary>
      <Field form={form} name="temperature" label={c('Вариативность ответа', 'Response temperature')} type="number" tooltip={c('От 0 до 2. Меньше — предсказуемее, больше — разнообразнее.', 'From 0 to 2. Lower values are more predictable; higher values are more varied.')} />
      <Field form={form} name="maxTokens" label={c('Максимальная длина ответа в токенах', 'Maximum response tokens')} type="number" />
    </details>
  </FormShell>;
}
