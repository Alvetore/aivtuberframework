import { afterEach, describe, expect, it, vi } from 'vitest';
import { TtsClient, selectSystemVoice } from './tts-client.js';

function speechSetup() {
  const utterances: any[] = [];
  const sent: any[] = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  vi.stubGlobal('window', { speechSynthesis: {
    getVoices: () => [],
    speak: (u: any) => utterances.push(u),
    cancel: () => utterances.at(-1)?.onerror?.(),
  } });
  const client = new TtsClient({ send: (message) => sent.push(message) });
  return { client, utterances, sent, done: () => sent.filter((m) => m.type === 'tts_done') };
}

describe('TTS renderer cancellation', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('acknowledges synchronous speech cancellation once with its playback ID', () => {
    const t = speechSetup();
    t.client.speak({ id: 'old', text: 'repeat', engine: 'webspeech' });
    t.client.cancel();
    expect(t.done()).toEqual([{ type: 'tts_done', payload: { text: 'repeat', id: 'old' } }]);
  });

  it('ignores an old utterance callback when the new utterance has the same text', () => {
    const t = speechSetup();
    t.client.speak({ id: 'old', text: 'repeat', engine: 'webspeech' });
    t.client.speak({ id: 'new', text: 'repeat', engine: 'webspeech' });
    t.utterances[0].onend();
    expect(t.done()).toHaveLength(1);
    t.utterances[1].onend();
    expect(t.done().map((m) => m.payload.id)).toEqual(['old', 'new']);
  });

  it('does not restart lipsync when cancelled audio.play resolves late', async () => {
    const t = speechSetup();
    let resolvePlay!: () => void;
    const analyse = vi.fn();
    vi.stubGlobal('Audio', class {
      pause() {} removeAttribute() {}
      play() { return new Promise<void>((r) => { resolvePlay = r; }); }
    });
    (window as any).AudioContext = class {
      state = 'running'; destination = {};
      createAnalyser() { return { frequencyBinCount: 4, connect() {}, getByteFrequencyData: analyse }; }
      createMediaElementSource() { return { connect() {} }; }
    };
    t.client.speak({ id: 'audio', text: 'old audio', engine: 'silero', audio: 'AA==' });
    t.client.cancel();
    resolvePlay(); await Promise.resolve();
    expect(analyse).not.toHaveBeenCalled();
    expect(t.done()).toEqual([{ type: 'tts_done', payload: { text: 'old audio', id: 'audio' } }]);
  });

  it('uses the selected voice URI, language and volume rather than the first Russian voice', () => {
    const t = speechSetup();
    const voices = [{name:'Russian',voiceURI:'ru',lang:'ru-RU'}, {name:'English selected',voiceURI:'chosen',lang:'en-GB'}] as SpeechSynthesisVoice[];
    window.speechSynthesis.getVoices = () => voices;
    t.client.speak({id:'chosen-playback',text:'Hello',engine:'webspeech',voice:'chosen',language:'en-GB',volume:.35});
    expect(t.utterances[0].voice).toBe(voices[1]);
    expect(t.utterances[0].lang).toBe('en-GB');
    expect(t.utterances[0].volume).toBe(.35);
    expect(t.sent.filter(m=>m.type==='tts_started')).toEqual([]);
    t.utterances[0].onstart();
    expect(t.sent.find(m=>m.type==='tts_started').payload.id).toBe('chosen-playback');
  });

  it('supports legacy voice names and reports a missing selection with a language fallback', () => {
    const voices = [{name:'Legacy',voiceURI:'legacy-uri',lang:'en-GB'},{name:'Russian',voiceURI:'ru-uri',lang:'ru-RU'}] as SpeechSynthesisVoice[];
    expect(selectSystemVoice(voices,'Legacy','ru-RU')).toEqual({voice:voices[0],missing:false});
    expect(selectSystemVoice(voices,'removed','ru-RU')).toEqual({voice:voices[1],missing:true});
    const t = speechSetup();window.speechSynthesis.getVoices=()=>voices;
    t.client.speak({id:'missing',text:'Тест',engine:'webspeech',voice:'removed',language:'ru-RU'});
    expect(t.sent.filter(m=>m.type==='player_warning')).toHaveLength(1);
  });

  it('reports actual speech errors instead of successful playback', () => {
    const t=speechSetup();
    t.client.speak({id:'failed',text:'test',engine:'webspeech'});
    t.utterances[0].onerror();
    expect(t.done()[0].payload).toMatchObject({id:'failed',error:expect.any(String)});
  });

  it('applies element output and volume when Web Audio sink selection is unavailable', async () => {
    const t=speechSetup();
    const sinks:string[]=[];const players:any[]=[];
    vi.stubGlobal('Audio',class {volume=1;constructor(){players.push(this);}async setSinkId(id:string){sinks.push(id);}play(){return Promise.resolve();}pause(){}removeAttribute(){}});
    t.client.speak({id:'sink',text:'audio',engine:'silero',audio:'AA==',volume:.4,outputDeviceId:'headphones'});
    await Promise.resolve();await Promise.resolve();
    expect(sinks).toEqual(['headphones']);
    expect(players[0].volume).toBe(.4);
    expect(t.sent.filter(m=>m.type==='tts_started')).toHaveLength(1);
  });

  it('falls back to default output when a saved device disappears', async () => {
    const t=speechSetup();const sinks:string[]=[];
    vi.stubGlobal('Audio',class {async setSinkId(id:string){sinks.push(id);if(id)throw new Error('missing');}play(){return Promise.resolve();}pause(){}removeAttribute(){}});
    t.client.speak({id:'sink',text:'audio',engine:'openai',audio:'AA==',outputDeviceId:'removed'});
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    expect(sinks).toEqual(['removed','']);
    expect(t.sent.filter(m=>m.type==='player_warning')).toHaveLength(1);
  });

  it('does not start audio when cancelled during asynchronous device selection', async () => {
    const t=speechSetup();let resolveSink!:()=>void;const play=vi.fn(()=>Promise.resolve());
    vi.stubGlobal('Audio',class {setSinkId(){return new Promise<void>(r=>{resolveSink=r;});}play=play;pause(){}removeAttribute(){}});
    t.client.speak({id:'old-sink',text:'old',engine:'elevenlabs',audio:'AA==',outputDeviceId:'headphones'});
    t.client.cancel();resolveSink();await Promise.resolve();await Promise.resolve();
    expect(play).not.toHaveBeenCalled();expect(t.done()).toHaveLength(1);
  });

  it('routes through the AudioContext output when audio is connected to Web Audio', async () => {
    const t=speechSetup();const contextSinks:string[]=[];const elementSink=vi.fn(async()=>{});
    vi.stubGlobal('Audio',class {setSinkId=elementSink;play(){return Promise.resolve();}pause(){}removeAttribute(){}});
    (window as any).AudioContext=class {state='running';destination={};async setSinkId(id:string){contextSinks.push(id);}close(){return Promise.resolve();}createAnalyser(){return {frequencyBinCount:2,connect(){},getByteFrequencyData(){}};}createMediaElementSource(){return {connect(){}};}};
    t.client.speak({id:'context-sink',text:'audio',engine:'silero',audio:'AA==',outputDeviceId:'speaker'});
    await Promise.resolve();await Promise.resolve();
    expect(contextSinks).toEqual(['speaker']);expect(elementSink).not.toHaveBeenCalled();
    t.client.cancel();
  });

  it('reports unsupported output selection and keeps the system audio route', async()=>{
    const t=speechSetup();const play=vi.fn(()=>Promise.resolve());
    vi.stubGlobal('Audio',class {play=play;pause(){}removeAttribute(){}});
    t.client.speak({id:'unsupported',text:'audio',engine:'openai',audio:'AA==',outputDeviceId:'speaker'});
    await Promise.resolve();expect(play).toHaveBeenCalledOnce();
    expect(t.sent.filter(m=>m.type==='player_warning')).toHaveLength(1);t.client.cancel();
  });
});
