import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultSettings } from '../../shared/types';
vi.mock('../hooks/api',()=>({api:vi.fn(),websocketUrl:()=> 'ws://127.0.0.1/ws'}));
vi.mock('../live2d/Live2DCanvas',()=>({Live2DCanvas:(props:{modelPath:string;clean:boolean;offsetX?:number;offsetY?:number})=><canvas data-model={props.modelPath} data-clean={String(props.clean)} data-x={props.offsetX} data-y={props.offsetY}/>}));
import { AvatarOverlay, AvatarPreview } from './AvatarOverlay';
import { AvatarForm } from '../forms/AvatarForm';
import { TtsForm } from '../forms/TtsForm';
import { I18nProvider } from '../i18n';
afterEach(()=>vi.unstubAllGlobals());
describe('avatar media surfaces',()=>{
  it('starts the OBS overlay clean before asynchronous settings arrive',()=>{
    const html=renderToStaticMarkup(<AvatarOverlay/>);
    expect(html).toContain('is-clean');expect(html).not.toContain('overlay-controls');expect(html).not.toContain('<button');
  });
  it('passes saved placement and clean mode to the model surface',()=>{
    const html=renderToStaticMarkup(<AvatarPreview clean settings={{...defaultSettings,avatarMode:'internal',live2dModelPath:'C:/model/avatar.model3.json',live2dOffsetX:12,live2dOffsetY:-8}}/>);
    expect(html).toContain('data-clean="true"');expect(html).toContain('data-x="12"');expect(html).toContain('data-y="-8"');expect(html).not.toContain('<button');
  });
  it('renders the retained SVG fallback with unique gradient identifiers',()=>{
    const html=renderToStaticMarkup(<><AvatarPreview settings={defaultSettings}/><AvatarPreview settings={defaultSettings}/></>);
    const ids=[...html.matchAll(/id="([^"]*hairGrad)"/g)].map(match=>match[1]);
    expect(ids).toHaveLength(2);expect(new Set(ids).size).toBe(2);expect(html).not.toContain('<audio');
  });
  it('renders media settings in English when the saved UI language is English',()=>{
    vi.stubGlobal('localStorage',{getItem:()=> 'en'});
    const html=renderToStaticMarkup(<I18nProvider><TtsForm initial={defaultSettings} onSave={async()=>{}} saving={false}/><AvatarForm initial={{...defaultSettings,avatarMode:'internal'}} onSave={async()=>{}} saving={false}/></I18nProvider>);
    expect(html).toContain('Speech synthesis');expect(html).toContain('Apply and listen');expect(html).toContain('Clean OBS window');expect(html).toContain('Reset placement');
    expect(html).not.toContain('Озвучивать ответы');expect(html).not.toContain('Способ отображения');
  });
});
