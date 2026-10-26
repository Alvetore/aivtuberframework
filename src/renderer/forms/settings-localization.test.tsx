import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../i18n';
import { ConnectionsPage } from '../pages/ConnectionsPage';
import { Profiles } from '../pages/Profiles';
import { defaultSettings } from '../../shared/types';
import type { Snapshot } from '../../shared/product';

afterEach(() => vi.unstubAllGlobals());
function render(language: 'ru'|'en') {
  vi.stubGlobal('localStorage', { getItem: () => language });
  const snapshot = { runtime: { state: 'running', profileId: 'test' }, profiles: [{ id: 'test', name: 'Test' }] } as Snapshot;
  return renderToStaticMarkup(<I18nProvider>
    <ConnectionsPage initial={{ ...defaultSettings, llmApiKey: '***', twitchOauthToken: '***' }} onSave={async () => {}} saving={false} />
    <Profiles snapshot={snapshot} onChanged={async () => {}} />
  </I18nProvider>);
}
describe('settings and profiles localization', () => {
  it('renders English labels, hints, key controls and profile actions throughout', () => {
    const output = render('en');
    for (const label of ['Model and API', 'Custom compatible API', 'Local API', 'Key saved', 'Replace', 'Delete', 'Apply and connect', 'Advanced settings', 'Character profile', 'Export JSON', 'Import JSON', 'Pause the host']) expect(output).toContain(label);
    expect(output).not.toMatch(/[А-Яа-яЁё]/);
  });
  it('retains Russian settings and profile copy', () => {
    const output = render('ru');
    for (const label of ['Модель и API', 'Ключ сохранён', 'Применить и подключить', 'Профиль персонажа', 'Экспорт JSON']) expect(output).toContain(label);
  });
});
