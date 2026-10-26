import { describe, expect, it } from 'vitest';
import { DraftStore, mergeDraft, sanitizeDraft } from './drafts';

describe('RAM-only form drafts', () => {
  it('merges a server refresh without replacing edited fields', () => {
    const baseline = { characterName: 'До', responseStyle: 'Коротко', maxTokens: 100 };
    const edited = { ...baseline, characterName: 'Мой черновик', maxTokens: 0 };
    expect(mergeDraft(baseline, edited, { characterName: 'С сервера', responseStyle: 'Новый стиль', maxTokens: 200 }))
      .toEqual({ characterName: 'Мой черновик', responseStyle: 'Новый стиль', maxTokens: 0 });
  });
  it('retains intentionally cleared secrets across refresh', () => {
    expect(mergeDraft({ llmApiKey: '***' }, { llmApiKey: '' }, { llmApiKey: '***' })).toEqual({ llmApiKey: '' });
  });
  it('acknowledges a save without losing edits made while it was pending', () => {
    const submitted = { llmApiKey: 'submitted-key', llmModel: 'submitted-model', maxTokens: '100' };
    const current = { llmApiKey: 'newer-key', llmModel: 'submitted-model', maxTokens: '100' };
    const acknowledged = sanitizeDraft({ llmApiKey: 'submitted-key', llmModel: 'submitted-model', maxTokens: 100 });
    expect(mergeDraft(submitted, current, acknowledged)).toEqual({ llmApiKey: 'newer-key', llmModel: 'submitted-model', maxTokens: 100 });
  });
  it('removes all four plaintext secrets after successful save while retaining explicit deletions', () => {
    expect(sanitizeDraft({ llmApiKey: 'private-a', twitchOauthToken: 'private-b', openaiTtsApiKey: '', elevenlabsApiKey: 'private-c', ttsVolume: 0, ttsEnabled: false }))
      .toEqual({ llmApiKey: '***', twitchOauthToken: '***', openaiTtsApiKey: '', elevenlabsApiKey: '***', ttsVolume: 0, ttsEnabled: false });
  });
  it('detects drafts from unmounted sections and clears them on confirmed profile change', () => {
    const store = new DraftStore();
    store.entries.set('llm', { baseline: { llmModel: 'old' }, values: { llmModel: 'edited' } });
    expect(store.hasDirtyDrafts()).toBe(true);
    store.discardAllDrafts();
    expect(store.hasDirtyDrafts()).toBe(false);
    expect(store.entries.size).toBe(0);
  });
});
