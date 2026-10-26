import type { EventBus } from './event-bus.js';
import type { Settings } from '../shared/types.js';
import type { Operation, QueueSnapshot } from '../shared/product.js';
import { redactSecrets } from './redact.js';

export type TtsEngine = 'webspeech' | 'silero' | 'openai' | 'elevenlabs';
export type PublishFn = (type: string, payload: unknown) => void;

export interface TtsContext {
  bus: EventBus;
  publish: PublishFn;
  getSettings: () => Settings;
  getStatus?: () => unknown;
  onOperation?: (id: string, stage: Operation['stage'], outcome?: Operation['outcome'], error?: string, metrics?: { synthesisMs?: number; playbackMs?: number }) => void;
  onPlayback?: (stage: 'queued' | 'speaking' | 'finished', error?: string) => void;
}

export interface TtsProvider {
  readonly name: TtsEngine;
  speak(text: string): Promise<void>;
  cancel(): void;
  notifyDone?(text: string, id?: string, error?: string): void;
  notifyStarted?(text: string, id?: string): void;
}

export function resolveTtsProvider(ctx: TtsContext): TtsProvider {
  const settings = ctx.getSettings();
  const engine = (settings as Settings & { ttsEngine?: TtsEngine }).ttsEngine ?? 'webspeech';
  if (engine === 'silero') {
    const endpoint = (settings as Settings & { sileroEndpoint?: string }).sileroEndpoint ?? 'http://127.0.0.1:5000';
    const speaker = (settings as Settings & { sileroSpeaker?: string }).sileroSpeaker ?? 'xenia';
    const sampleRate = (settings as Settings & { sileroSampleRate?: number }).sileroSampleRate ?? 48000;
    return new SileroProvider(ctx, endpoint, speaker, sampleRate);
  }
  if (engine === 'openai') {
    const endpoint = (settings as Settings & { openaiTtsEndpoint?: string }).openaiTtsEndpoint || 'https://api.openai.com/v1/audio/speech';
    const apiKey = (settings as Settings & { openaiTtsApiKey?: string }).openaiTtsApiKey || settings.llmApiKey || '';
    const model = (settings as Settings & { openaiTtsModel?: string }).openaiTtsModel || 'tts-1';
    const voice = (settings as Settings & { openaiTtsVoice?: string }).openaiTtsVoice || 'nova';
    return new OpenAiTtsProvider(ctx, endpoint, apiKey, model, voice);
  }
  if (engine === 'elevenlabs') {
    const apiKey = (settings as Settings & { elevenlabsApiKey?: string }).elevenlabsApiKey || '';
    const voiceId = (settings as Settings & { elevenlabsVoiceId?: string }).elevenlabsVoiceId || '21m00Tcm4TlvDq8ikWAM';
    const model = (settings as Settings & { elevenlabsModel?: string }).elevenlabsModel || 'eleven_multilingual_v2';
    return new ElevenLabsTtsProvider(ctx, apiKey, voiceId, model);
  }
  return new WebSpeechBridgeProvider(ctx);
}

abstract class BaseProvider implements TtsProvider {
  abstract readonly name: TtsEngine;
  protected ctx: TtsContext;
  protected current: { id: string; text: string; resolve: () => void; reject: (error: Error) => void; timer?: NodeJS.Timeout } | null = null;
  constructor(ctx: TtsContext) { this.ctx = ctx; }
  protected emitStart(text: string) { this.ctx.bus.emit('TTS_START', { text, engine: this.name }); }
  protected emitEnd() { this.ctx.bus.emit('TTS_END', undefined); }
  abstract speak(text: string): Promise<void>;
  notifyStarted(text: string, id?: string) {
    if (this.current && this.current.id === id && this.current.text === text) this.ctx.onPlayback?.('speaking');
  }
  notifyDone(text: string, id?: string, error?: string) {
    if (this.current && this.current.id === id && this.current.text === text) {
      if (this.current.timer) clearTimeout(this.current.timer);
      const current = this.current;
      this.current = null;
      this.ctx.onPlayback?.('finished', error);
      if (error) current.reject(new Error(error)); else current.resolve();
    }
  }
  cancel() {
    if (this.current) {
      if (this.current.timer) clearTimeout(this.current.timer);
      const r = this.current.reject;
      this.current = null;
      this.ctx.publish('tts_cancel', {});
      r(new Error('Озвучивание отменено.'));
    }
  }
  protected waitForPlayback(text: string, publishPayload: Record<string, unknown>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeoutMs = Math.max(8_000, text.length * 150);
      const timer = setTimeout(() => {
        if (this.current?.id === id) {
          this.ctx.bus.emit('LOG', {
            level: 'info',
            source: 'TTS',
            message: `Таймаут воспроизведения (${timeoutMs}ms), очередь разблокирована.`,
          });
          this.current = null;
          this.ctx.publish('tts_cancel', { id });
          reject(new Error('Плеер не подтвердил завершение озвучивания.'));
        }
      }, timeoutMs);
      this.current = { id, text, resolve, reject, timer };
      this.ctx.onPlayback?.('queued');
      const settings = this.ctx.getSettings();
      this.ctx.publish('tts_speak', { ...publishPayload, id, voice: settings.ttsVoice, language: settings.ttsLanguage || 'ru-RU', volume: settings.ttsVolume ?? 1, outputDeviceId: settings.audioOutputDeviceId || '' });
    });
  }
}

class WebSpeechBridgeProvider extends BaseProvider {
  readonly name: TtsEngine = 'webspeech';
  async speak(text: string): Promise<void> {
    this.emitStart(text);
    try {
      await this.waitForPlayback(text, { text, engine: 'webspeech' });
    } finally {
      this.emitEnd();
    }
  }
}

class SileroProvider extends BaseProvider {
  readonly name: TtsEngine = 'silero';
  private controller?: AbortController;
  constructor(ctx: TtsContext, private endpoint: string, private speaker: string, private sampleRate = 48000) {
    super(ctx);
  }
  async speak(text: string): Promise<void> {
    this.cancel();
    this.controller = new AbortController();
    const controller = this.controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]);
    this.emitStart(text);
    try {
      const response = await fetch(`${this.endpoint.replace(/\/$/, '')}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ text, speaker: this.speaker, sample_rate: this.sampleRate }),
      });
      if (!response.ok) throw new Error(`Silero TTS ${response.status}`);
      const buf = Buffer.from(await response.arrayBuffer());
      signal.throwIfAborted();
      const base64 = buf.toString('base64');
      await this.waitForPlayback(text, {
        text,
        engine: 'silero',
        audio: base64,
        mime: response.headers.get('content-type') ?? 'audio/wav',
      });
    } finally {
      this.emitEnd();
    }
  }
  cancel() {
    this.controller?.abort();
    super.cancel();
  }
}

class OpenAiTtsProvider extends BaseProvider {
  readonly name: TtsEngine = 'openai';
  private controller?: AbortController;
  constructor(
    ctx: TtsContext,
    private endpoint: string,
    private apiKey: string,
    private model: string,
    private voice: string
  ) {
    super(ctx);
  }

  async speak(text: string): Promise<void> {
    this.cancel();
    this.controller = new AbortController();
    const controller = this.controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]);
    this.emitStart(text);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: this.model || 'tts-1',
          input: text,
          voice: this.voice || 'nova',
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`OpenAI TTS ${response.status}: ${redactSecrets(errText.slice(0, 150))}`);
      }

      const buf = Buffer.from(await response.arrayBuffer());
      signal.throwIfAborted();
      const base64 = buf.toString('base64');
      await this.waitForPlayback(text, {
        text,
        engine: 'openai',
        audio: base64,
        mime: 'audio/mpeg',
      });
    } finally {
      this.emitEnd();
    }
  }

  cancel() {
    this.controller?.abort();
    super.cancel();
  }
}

class ElevenLabsTtsProvider extends BaseProvider {
  readonly name: TtsEngine = 'elevenlabs';
  private controller?: AbortController;
  constructor(
    ctx: TtsContext,
    private apiKey: string,
    private voiceId: string,
    private model: string
  ) {
    super(ctx);
  }

  async speak(text: string): Promise<void> {
    this.cancel();
    this.controller = new AbortController();
    const controller = this.controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]);
    this.emitStart(text);
    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId || '21m00Tcm4TlvDq8ikWAM')}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      };
      if (this.apiKey) {
        headers['xi-api-key'] = this.apiKey;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          text,
          model_id: this.model || 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`ElevenLabs TTS ${response.status}: ${redactSecrets(errText.slice(0, 150))}`);
      }

      const buf = Buffer.from(await response.arrayBuffer());
      signal.throwIfAborted();
      const base64 = buf.toString('base64');
      await this.waitForPlayback(text, {
        text,
        engine: 'elevenlabs',
        audio: base64,
        mime: 'audio/mpeg',
      });
    } finally {
      this.emitEnd();
    }
  }

  cancel() {
    this.controller?.abort();
    super.cancel();
  }
}

export class TtsQueue {
  private queue: { text: string; operationId?: string }[] = [];
  private activeRun: { text: string; operationId?: string; preview?: boolean; cancel?: () => void } | null = null;
  private provider: TtsProvider;
  private ctx: TtsContext;
  constructor(ctx: TtsContext) {
    this.ctx = ctx;
    this.provider = resolveTtsProvider(ctx);
  }
  rebuild() {
    this.cancel();
    this.provider = resolveTtsProvider(this.ctx);
  }
  enqueue(text: string, operationId?: string) {
    if (!this.ctx.getSettings().ttsEnabled) return;
    this.queue.push({ text, operationId });
    this.changed();
    void this.drain();
  }
  cancel() {
    const pending = [...this.queue, ...(this.activeRun ? [this.activeRun] : [])];
    this.queue = [];
    const run = this.activeRun;
    this.activeRun = null;
    for (const item of pending) if (item.operationId) this.ctx.onOperation?.(item.operationId, 'finished', 'cancelled');
    this.provider.cancel();
    run?.cancel?.();
    this.ctx.publish('tts_cancel', {});
    this.changed();
  }
  get state(): 'speaking' | 'idle' { return this.activeRun ? 'speaking' : 'idle'; }
  get snapshot(): QueueSnapshot { return { state: this.state, pending: this.queue.length, text: this.activeRun?.text, operationId: this.activeRun?.operationId }; }
  notifyDone(text: string, id?: string, error?: string) { this.provider.notifyDone?.(text, id, error); }
  notifyStarted(text: string, id?: string) { this.provider.notifyStarted?.(text, id); }
  private changed() {
    this.ctx.publish('queue', this.snapshot);
    if (this.ctx.getStatus) this.ctx.publish('status', this.ctx.getStatus());
  }
  async preview(text: string): Promise<void> {
    if (this.activeRun?.preview) throw new Error('Уже идёт прослушивание голоса.');
    this.cancel();
    const run = { text, preview: true, cancel: undefined as (() => void) | undefined };
    this.activeRun = run;
    const settings = { ...this.ctx.getSettings(), ttsEnabled: true };
    const provider = resolveTtsProvider({ ...this.ctx, getSettings: () => settings });
    this.provider = provider;
    let cancelReject!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { cancelReject = reject; });
    run.cancel = () => cancelReject(new Error('Прослушивание отменено.'));
    this.changed();
    try { await Promise.race([provider.speak(text), cancelled]); }
    finally {
      if (this.activeRun === run) { this.activeRun = null; this.provider = resolveTtsProvider(this.ctx); this.changed(); }
    }
  }
  private async drain() {
    if (!this.ctx.getSettings().ttsEnabled) {
      this.queue = [];
      return;
    }
    if (this.activeRun) return;
    const item = this.queue.shift();
    if (!item) return;
    const run = { ...item };
    this.activeRun = run;
    const startedAt = Date.now();
    let playbackAt: number | undefined;
    const update: NonNullable<TtsContext['onPlayback']> = (stage) => {
      if (this.activeRun !== run || !item.operationId) return;
      if (stage === 'queued') this.ctx.onOperation?.(item.operationId, 'queued', 'pending', undefined, { synthesisMs: Date.now() - startedAt });
      if (stage === 'speaking') {
        playbackAt ??= Date.now();
        this.ctx.onOperation?.(item.operationId, 'speaking', 'pending');
      }
    };
    const provider = resolveTtsProvider({ ...this.ctx, onPlayback: update });
    this.provider = provider;
    if (item.operationId) this.ctx.onOperation?.(item.operationId, this.ctx.getSettings().ttsEngine === 'webspeech' ? 'queued' : 'synthesizing', 'pending');
    this.changed();
    try {
      await provider.speak(item.text);
      if (this.activeRun === run && item.operationId) this.ctx.onOperation?.(item.operationId, 'finished', 'completed', undefined, { playbackMs: playbackAt === undefined ? undefined : Date.now() - playbackAt });
    }
    catch (e) {
      if (this.activeRun === run) {
        const error = redactSecrets(e instanceof Error ? e.message : String(e));
        if (item.operationId) this.ctx.onOperation?.(item.operationId, 'finished', 'failed', error);
        this.ctx.bus.emit('LOG', { level: 'error', source: 'TTS', message: error });
      }
    }
    finally {
      // A cancelled generation can settle after a newer playback has started.
      if (this.activeRun !== run) return;
      this.activeRun = null;
      this.changed();
      void this.drain();
    }
  }
}
