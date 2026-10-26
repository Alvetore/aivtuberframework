import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../event-bus.js';
import { TtsQueue } from '../tts.js';
import { defaultSettings, type Settings } from '../../shared/types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function setup(change: Partial<Settings> = {}) {
  let settings = { ...defaultSettings, ...change };
  const published: { type: string; payload: any }[] = [];
  const queue = new TtsQueue({
    bus: new EventBus(), getSettings: () => settings,
    publish: (type, payload) => published.push({ type, payload }),
  });
  return {
    queue, published,
    update(change: Partial<Settings>) { settings = { ...settings, ...change }; queue.rebuild(); },
    spoken: () => published.filter((m) => m.type === 'tts_speak').map((m) => m.payload),
  };
}

const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

describe('TTS cancellation and disabled queue', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('clears active playback and backlog on disable; enabling does not resurrect them', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.queue.enqueue('active'); t.queue.enqueue('queued');
    const old = t.spoken()[0];
    t.update({ ttsEnabled: false });
    t.queue.enqueue('disabled');
    expect(t.queue.state).toBe('idle');
    await flush();
    t.update({ ttsEnabled: true });
    await flush();
    expect(t.spoken().map((m) => m.text)).toEqual(['active']);
    t.queue.enqueue('fresh');
    t.queue.notifyDone(old.text, old.id);
    expect(t.queue.state).toBe('speaking');
    t.queue.cancel();
    await flush();
  });

  it('ignores stale completion for the same text after cancel and restart', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.queue.enqueue('repeat');
    const old = t.spoken()[0];
    t.queue.cancel(); t.queue.enqueue('repeat');
    const current = t.spoken()[1];
    expect(current.id).not.toBe(old.id);
    t.queue.notifyDone('repeat', old.id);
    t.queue.notifyDone('repeat');
    await flush();
    expect(t.queue.state).toBe('speaking');
    t.queue.notifyDone('repeat', current.id);
    await flush();
    expect(t.queue.state).toBe('idle');
  });

  it.each(['silero', 'openai', 'elevenlabs'] as const)('does not publish late %s synthesis after disabling', async (engine) => {
    vi.useFakeTimers();
    const body = deferred<ArrayBuffer>();
    let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init.signal;
      return { ok: true, headers: new Headers(), arrayBuffer: () => body.promise };
    }));
    const t = setup({ ttsEngine: engine });
    t.queue.enqueue('old'); t.queue.enqueue('backlog');
    await flush();
    t.update({ ttsEnabled: false });
    expect(signal.aborted).toBe(true);
    body.resolve(new ArrayBuffer(1));
    await flush();
    expect(t.spoken()).toEqual([]);
    expect(t.queue.state).toBe('idle');
    t.update({ ttsEnabled: true, ttsEngine: 'webspeech' });
    t.queue.enqueue('new');
    expect(t.spoken().map((m) => m.text)).toEqual(['new']);
    t.queue.cancel(); await flush();
  });

  it('a synthesis that ignores abort does not block fresh playback after enabling', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const t = setup({ ttsEngine: 'silero' });
    t.queue.enqueue('never finishes');
    t.update({ ttsEnabled: false });
    t.update({ ttsEnabled: true, ttsEngine: 'webspeech' });
    t.queue.enqueue('fresh');
    expect(t.spoken().map((m) => m.text)).toEqual(['fresh']);
    expect(t.queue.state).toBe('speaking');
    t.queue.cancel(); await flush();
  });

  it('a stale synthesis finalizer cannot reset a newer playback', async () => {
    vi.useFakeTimers();
    const response = deferred<any>();
    vi.stubGlobal('fetch', vi.fn(() => response.promise));
    const t = setup({ ttsEngine: 'silero' });
    t.queue.enqueue('old');
    t.update({ ttsEnabled: false });
    t.update({ ttsEnabled: true, ttsEngine: 'webspeech' });
    t.queue.enqueue('new'); t.queue.enqueue('after new');
    response.resolve({ ok: true, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(1) });
    await flush();
    expect(t.queue.state).toBe('speaking');
    expect(t.spoken().map((m) => m.text)).toEqual(['new']);
    const current = t.spoken()[0];
    t.queue.notifyDone(current.text, current.id);
    await flush();
    expect(t.spoken().map((m) => m.text)).toEqual(['new', 'after new']);
    t.queue.cancel(); await flush();
  });

  it('tracks queue operations through real playback acknowledgement and never completes cancelled work', async()=>{
    vi.useFakeTimers();const published:any[]=[];const updates:any[]=[];
    const queue=new TtsQueue({bus:new EventBus(),getSettings:()=>defaultSettings,publish:(type,payload)=>published.push({type,payload}),onOperation:(...args)=>updates.push(args)});
    queue.enqueue('one','op1');queue.enqueue('two','op2');
    expect(queue.snapshot).toMatchObject({state:'speaking',pending:1,operationId:'op1',text:'one'});
    const speech=published.find(m=>m.type==='tts_speak').payload;
    expect(speech).toMatchObject({voice:defaultSettings.ttsVoice,language:defaultSettings.ttsLanguage,volume:1});
    expect(updates.some(u=>u[1]==='speaking')).toBe(false);
    queue.notifyStarted(speech.text,speech.id);
    expect(updates.some(u=>u[0]==='op1'&&u[1]==='speaking')).toBe(true);
    queue.cancel();queue.notifyDone(speech.text,speech.id);await flush();
    expect(updates.filter(u=>u[2]==='cancelled').map(u=>u[0]).sort()).toEqual(['op1','op2']);
    expect(updates.some(u=>u[2]==='completed')).toBe(false);
  });

  it('voice preview works when speech is disabled, stays separate and reports failures',async()=>{
    vi.useFakeTimers();const t=setup({ttsEnabled:false});
    const preview=t.queue.preview('preview');
    const result=preview.catch(e=>e.message);
    const speech=t.spoken()[0];
    expect(speech.text).toBe('preview');
    await expect(t.queue.preview('second')).rejects.toThrow('Уже идёт');
    t.queue.notifyDone(speech.text,speech.id,'device failed');
    expect(await result).toBe('device failed');
    expect(t.queue.snapshot).toMatchObject({state:'idle',pending:0});
    t.queue.enqueue('disabled');expect(t.spoken()).toHaveLength(1);
  });

  it('cancels a stuck preview immediately and ignores synthesis that resolves after cancel',async()=>{
    vi.useFakeTimers();const body=deferred<ArrayBuffer>();
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,headers:new Headers(),arrayBuffer:()=>body.promise})));
    const t=setup({ttsEngine:'silero'});const preview=t.queue.preview('old preview').catch(e=>e.message);
    await flush();t.queue.cancel();expect(await preview).toContain('отменено');
    body.resolve(new ArrayBuffer(1));await flush();expect(t.spoken()).toEqual([]);
  });
});
