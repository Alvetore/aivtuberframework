import { useI18n } from '../i18n';

interface Tab { id: string; label: string }
interface Props { tabs: readonly Tab[]; active: string; onSelect: (id: string) => void }

export function Sidebar({ tabs, active, onSelect }: Props) {
  const { lang, setLang } = useI18n();

  return (
    <aside className="app-sidebar">
      <div>
        <h1><span aria-hidden="true">✦</span> AI VTuber</h1>
        <p>{lang === 'ru' ? 'Студия виртуальной ведущей' : 'Virtual host studio'}</p>
        <nav aria-label={lang === 'ru' ? 'Разделы приложения' : 'App sections'}>
          {tabs.map((tabItem) => (
            <button type="button" key={tabItem.id} aria-current={active === tabItem.id ? 'page' : undefined} className={active === tabItem.id ? 'active' : ''} onClick={() => onSelect(tabItem.id)}>
              <span className="nav-symbol" aria-hidden="true">{({live: '◉', character: '✦', tts: '♫', avatar: '◈', connections: '⇄', diagnostics: '≡'} as Record<string, string>)[tabItem.id] ?? '·'}</span>{tabItem.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="sidebar-footer">
        <button
          type="button"
          className="lang-switch-btn"
          onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
          title={lang === 'ru' ? 'Switch to English' : 'Переключить на русский'}
        >
          <span>{lang === 'ru' ? '🇷🇺 Русский' : '🇬🇧 English'}</span>
        </button>
      </div>
    </aside>
  );
}
