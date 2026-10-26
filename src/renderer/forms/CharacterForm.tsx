import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Settings } from '../../shared/types';
import { CharacterFormSchema, type CharacterFormData } from './schemas';
import { FormShell, Field, Select } from './FormShell';
import { useFormDraft } from './drafts';

interface Props {
  initial: Settings;
  onSave: (data: CharacterFormData) => Promise<void>;
  saving: boolean;
  notice?: string;
}

import { useI18n } from '../i18n';

export function CharacterForm({ initial, onSave, saving, notice }: Props) {
  const { t } = useI18n();
  const defaults: CharacterFormData = {
      characterName: initial.characterName,
      characterLanguage: initial.characterLanguage ?? 'ru',
      characterPrompt: initial.characterPrompt,
      responseStyle: initial.responseStyle,
    };
  const form = useForm<CharacterFormData>({
    resolver: zodResolver(CharacterFormSchema),
    defaultValues: defaults,
  });
  const draft = useFormDraft('character', form, defaults);
  const submit = form.handleSubmit(draft.submit(onSave));
  return (
    <FormShell form={form} draft={draft} onSave={submit} saving={saving} notice={notice}>
      <Field
        form={form}
        name="characterName"
        label={t('char.title')}
        tooltip={t('char.titleTooltip')}
      />
      <Select
        form={form}
        name="characterLanguage"
        label={t('char.language')}
        options={[
          { value: 'ru', label: t('char.langRu') },
          { value: 'en', label: t('char.langEn') },
          { value: 'auto', label: t('char.langAuto') },
        ]}
        tooltip={t('char.languageTooltip')}
      />
      <Field
        form={form}
        name="characterPrompt"
        label={t('char.prompt')}
        type="textarea"
        rows={6}
        tooltip={t('char.promptTooltip')}
      />
      <Field
        form={form}
        name="responseStyle"
        label={t('char.style')}
        type="textarea"
        rows={2}
        tooltip={t('char.styleTooltip')}
      />
    </FormShell>
  );
}
