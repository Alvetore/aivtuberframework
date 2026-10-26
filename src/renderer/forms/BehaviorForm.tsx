import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Settings } from '../../shared/types';
import { BehaviorFormSchema, type BehaviorFormData } from './schemas';
import { FormShell, Field, Select } from './FormShell';
import { useFormDraft } from './drafts';

interface Props {
  initial: Settings;
  onSave: (data: BehaviorFormData) => Promise<void>;
  saving: boolean;
  notice?: string;
}

import { useI18n } from '../i18n';

export function BehaviorForm({ initial, onSave, saving, notice }: Props) {
  const { t } = useI18n();
  const defaults: BehaviorFormData = {
      mode: initial.mode,
      contextMessageLimit: initial.contextMessageLimit,
      idleTimeoutSeconds: initial.idleTimeoutSeconds,
      responseCooldownSeconds: initial.responseCooldownSeconds,
      maxResponsesPerMinute: initial.maxResponsesPerMinute,
    };
  const form = useForm<BehaviorFormData>({
    resolver: zodResolver(BehaviorFormSchema),
    defaultValues: defaults,
  });
  const draft = useFormDraft('behavior', form, defaults);
  const submit = form.handleSubmit(draft.submit(onSave));
  return (
    <FormShell form={form} draft={draft} onSave={submit} saving={saving} notice={notice}>
      <Select
        form={form}
        name="mode"
        label={t('behavior.mode')}
        options={[
          { value: 'reactive', label: t('behavior.reactive') },
          { value: 'streamer', label: t('behavior.streamer') },
        ]}
        tooltip={t('behavior.modeTooltip')}
      />
      <Field
        form={form}
        name="contextMessageLimit"
        label={t('behavior.contextLimit')}
        type="number"
        tooltip={t('behavior.contextLimitTooltip')}
      />
      <Field
        form={form}
        name="idleTimeoutSeconds"
        label={t('behavior.idleTimeout')}
        type="number"
        tooltip={t('behavior.idleTimeoutTooltip')}
      />
      <Field
        form={form}
        name="responseCooldownSeconds"
        label={t('behavior.cooldown')}
        type="number"
        tooltip={t('behavior.cooldownTooltip')}
      />
      <Field
        form={form}
        name="maxResponsesPerMinute"
        label={t('behavior.maxPerMin')}
        type="number"
        tooltip={t('behavior.maxPerMinTooltip')}
      />
    </FormShell>
  );
}
