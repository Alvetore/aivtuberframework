import { useState } from 'react';
import { I18nProvider, useI18n } from './i18n';
import { Sidebar } from './components/Sidebar';
import { AvatarOverlay, AvatarPreview } from './components/AvatarOverlay';
import { CharacterForm } from './forms/CharacterForm';
import { BehaviorForm } from './forms/BehaviorForm';
import { TtsForm } from './forms/TtsForm';
import { AvatarForm } from './forms/AvatarForm';
import { DraftProvider } from './forms/drafts';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { Profiles } from './pages/Profiles';
import { LivePage } from './pages/LivePage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { useWorkspace } from './hooks/useWorkspace';

export function App(){
  if(new URLSearchParams(window.location.search).get('view')==='avatar') return <I18nProvider><AvatarOverlay/></I18nProvider>;
  return <I18nProvider><DraftProvider><AppMain/></DraftProvider></I18nProvider>;
}
function AppMain(){
  const workspace=useWorkspace();
  const [tab,setTab]=useState('live');
  const {lang}=useI18n();
  const en=lang==='en';
  const labels={live:en?'Live':'Эфир',character:en?'Character':'Персонаж',tts:en?'Voice':'Голос',avatar:en?'Avatar':'Аватар',connections:en?'Connections':'Подключения',diagnostics:en?'Diagnostics':'Диагностика'};
  const navigate=(id:string)=>setTab(({llm:'connections',twitch:'connections',behavior:'character',voice:'tts',dashboard:'live',logs:'diagnostics'} as Record<string,string>)[id]??id);
  const s=workspace.snapshot;
  if(!s) return <main className="loading"><div><h1>AI VTuber</h1><p>{workspace.error||'Подключение к студии…'}</p><button onClick={()=>void workspace.refresh().catch(()=>{})}>Повторить</button></div></main>;
  const formProps={initial:s.settings,saving:workspace.busy,onSave:workspace.save};
  return <main className="app-layout" data-server-instance={s.serverInstanceId}>
    <Sidebar tabs={Object.entries(labels).map(([id,label])=>({id,label}))} active={tab} onSelect={navigate}/>
    <section className="app-content">
      <header className="app-header"><div><span className="eyebrow">{s.profiles.find(p=>p.id===s.runtime.profileId)?.name??s.settings.characterName}</span><h2>{labels[tab as keyof typeof labels]}</h2></div><span className={`ws-state ws-${workspace.connection}`} role="status">{workspace.connection==='open'?(en?'Connected':'Связь установлена'):(en?'Reconnecting…':'Восстанавливаем связь…')}</span></header>
      {workspace.connection!=='open'&&<p className="connection-banner" role="alert">{en?'Connection lost. Audio stopped; resume the host explicitly after reconnecting.':'Связь потеряна. Звук остановлен; после подключения продолжите эфир вручную.'}</p>}
      {tab!=='live'&&workspace.error&&<p className="inline-error" role="alert">{workspace.error}</p>}
      <div hidden={tab!=='live'}><LivePage snapshot={s} connected={workspace.connection==='open'} busy={workspace.busy} error={workspace.error} onCommand={workspace.command} onTest={workspace.test} onNavigate={navigate} avatarPreview={<AvatarPreview settings={s.settings} mouthOpen={workspace.mouthOpen} onState={workspace.avatarState}/>}/></div>
      {tab==='character'&&<><Profiles snapshot={s} onChanged={workspace.refresh}/><div className="settings-grid"><article className="settings-card"><h3>{en?'Personality':'Личность и стиль'}</h3><CharacterForm {...formProps}/></article><article className="settings-card"><h3>{en?'Behaviour':'Поведение в эфире'}</h3><BehaviorForm {...formProps}/></article></div></>}
      {tab==='tts'&&<article className="settings-card"><TtsForm {...formProps} runtimeState={s.runtime.state}/></article>}
      {tab==='avatar'&&<article className="settings-card"><AvatarForm {...formProps} runtimeState={s.runtime.state}/></article>}
      {tab==='connections'&&<ConnectionsPage {...formProps}/>}
      {tab==='diagnostics'&&<DiagnosticsPage snapshot={s}/>}
    </section>
  </main>;
}
