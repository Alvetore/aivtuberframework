export interface TtsSpeakPayload { id: string; text: string; engine: 'webspeech' | 'silero' | 'openai' | 'elevenlabs'; audio?: string; mime?: string; voice?: string; language?: string; volume?: number; outputDeviceId?: string }
export interface LipSyncPublisher { send(payload: { type: string; payload: unknown }): void }
type SinkAudioContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
type SinkAudioElement = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

export function selectSystemVoice(voices: SpeechSynthesisVoice[], selected: string | undefined, language: string) {
  const exact = selected ? voices.find(v => v.voiceURI === selected || v.name === selected) : undefined;
  const compatible = voices.find(v => v.lang.toLowerCase() === language.toLowerCase()) || voices.find(v => v.lang.split('-')[0] === language.split('-')[0]);
  return { voice: exact || compatible, missing: Boolean(selected && !exact) };
}

class SileroAudioPlayer {
  private ctx?: SinkAudioContext;
  private analyser?: AnalyserNode;
  private audio?: SinkAudioElement;
  private raf = 0;
  private lastValue = 0;
  private generation = 0;

  constructor(private publisher: LipSyncPublisher, private warn: (message: string) => void) {}

  private initGraph(outputDeviceId: string) {
    if (this.ctx && this.audio) return;
    this.audio = new Audio();
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      try {
        this.ctx = new AudioCtx();
        // A media source connected to Web Audio uses the context's destination.
        // Keep the element route when only the element supports output selection.
        if (outputDeviceId && !this.ctx.setSinkId && typeof this.audio.setSinkId === 'function') {
          void this.ctx.close(); this.ctx = undefined; return;
        }
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        const source = this.ctx.createMediaElementSource(this.audio);
        source.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
      } catch {
        // Fallback if audio routing fails
      }
    }
  }

  async play(src: string, payload: TtsSpeakPayload, onStarted: () => void, onEnded: () => void, onError: (error: string) => void) {
    this.stop();
    const generation = this.generation;
    this.initGraph(payload.outputDeviceId || '');
    if (!this.audio) {
      onError('Аудиоплеер недоступен.');
      return;
    }
    this.audio.volume = Math.max(0, Math.min(1, payload.volume ?? 1));
    const sink = this.ctx?.setSinkId ? this.ctx : typeof this.audio.setSinkId === 'function' ? this.audio : undefined;
    if (payload.outputDeviceId) {
      if (!sink) this.warn('Выбор аудиовыхода недоступен: используется системное устройство.');
      else {
        try { await sink.setSinkId!(payload.outputDeviceId); }
        catch {
          if (generation !== this.generation) return;
          try { await sink.setSinkId!(''); }
          catch { onError('Аудиовыход недоступен. Выберите системное устройство.'); return; }
          this.warn('Выбранный аудиовыход недоступен: используется системное устройство.');
        }
      }
    }
    if (generation !== this.generation) return;
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.audio.src = src;
    this.audio.onended = () => {
      if (generation !== this.generation) return;
      this.stop();
      onEnded();
    };
    this.audio.onerror = () => {
      if (generation !== this.generation) return;
      this.stop();
      onError('Не удалось воспроизвести аудио.');
    };
    try {
      await this.audio.play();
      if (generation !== this.generation) return;
      onStarted();
      this.tick();
    } catch {
      if (generation !== this.generation) return;
      this.stop();
      onError('Воспроизведение заблокировано или аудиоустройство недоступно.');
    }
  }

  stop() {
    this.generation++;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      try { this.audio.pause(); } catch { /* noop */ }
      this.audio.removeAttribute('src');
    }
    if (this.ctx) { try { void this.ctx.close(); } catch { /* noop */ } }
    this.ctx = undefined; this.audio = undefined; this.analyser = undefined;
    this.lastValue = 0;
    this.publisher.send({ type: 'lipsync', payload: { value: 0 } });
  }

  private lastEmitTime = 0;

  private tick = () => {
    if (!this.analyser) return;
    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    const avg = sum / buf.length / 255;
    const value = Math.max(0, Math.min(1, avg * 1.6));
    const now = performance.now();
    if (now - this.lastEmitTime >= 33 && (Math.abs(value - this.lastValue) > 0.02 || (value === 0 && this.lastValue !== 0))) {
      this.lastValue = value;
      this.lastEmitTime = now;
      this.publisher.send({ type: 'lipsync', payload: { value } });
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}

class WebSpeechLipSync {
  private raf = 0;
  private lastValue = 0;
  private lastEmitTime = 0;
  constructor(private publisher: LipSyncPublisher) {}

  start() {
    this.stop();
    let phase = 0;
    this.lastEmitTime = 0;
    const step = () => {
      phase += 0.25;
      const raw = Math.sin(phase) * 0.35 + Math.cos(phase * 1.7) * 0.15 + 0.3;
      const value = Math.max(0, Math.min(0.75, raw));
      const now = performance.now();
      if (now - this.lastEmitTime >= 33 && Math.abs(value - this.lastValue) > 0.03) {
        this.lastValue = value;
        this.lastEmitTime = now;
        this.publisher.send({ type: 'lipsync', payload: { value } });
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.lastValue = 0;
    this.publisher.send({ type: 'lipsync', payload: { value: 0 } });
  }
}

export class TtsClient {
  private sileroPlayer: SileroAudioPlayer;
  private webSpeechLipSync: WebSpeechLipSync;
  private current: { id: string; text: string; isUtterance: boolean } | null = null;

  constructor(private publisher: LipSyncPublisher, private options: { onWarning?: (message: string) => void } = {}) {
    this.sileroPlayer = new SileroAudioPlayer(publisher, message => this.warn(message));
    this.webSpeechLipSync = new WebSpeechLipSync(publisher);
  }

  init() {
    // Voice discovery is owned by the form; avoid overwriting its event listener.
  }

  speak(payload: TtsSpeakPayload) {
    this.cancel();
    const current = { id: payload.id, text: payload.text, isUtterance: !payload.audio };
    this.current = current;
    if (payload.audio) {
      const src = `data:${payload.mime ?? 'audio/mpeg'};base64,${payload.audio}`;
      void this.sileroPlayer.play(
        src, payload,
        () => this.started(current),
        () => this.finish(current),
        (error) => this.finish(current, error),
      );
    } else {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { this.finish(current, 'Системный синтез речи недоступен.'); return; }
      const utterance = new SpeechSynthesisUtterance(payload.text);
      utterance.lang = payload.language || 'ru-RU';
      utterance.volume = Math.max(0, Math.min(1, payload.volume ?? 1));
      const { voice, missing } = selectSystemVoice(window.speechSynthesis.getVoices(), payload.voice, utterance.lang);
      if (voice) utterance.voice = voice;
      if (missing) this.warn('Сохранённый системный голос не найден: выбран доступный голос указанного языка.');
      utterance.onstart = () => { if (this.current === current) { this.started(current); this.webSpeechLipSync.start(); } };
      utterance.onend = () => this.finish(current);
      utterance.onerror = () => this.finish(current, 'Системный синтез речи завершился с ошибкой.');
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        this.finish(current, 'Не удалось запустить системный синтез речи.');
      }
    }
  }

  cancel() {
    if (!this.current) return;
    const current = this.current;
    this.current = null;
    this.sileroPlayer.stop();
    this.webSpeechLipSync.stop();
    if (current.isUtterance && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    }
    this.publisher.send({ type: 'tts_done', payload: { text: current.text, id: current.id } });
  }

  private warn(message: string) { this.options.onWarning?.(message); this.publisher.send({ type: 'player_warning', payload: { message } }); }
  private started(current: NonNullable<TtsClient['current']>) { if (this.current === current) this.publisher.send({ type: 'tts_started', payload: { text: current.text, id: current.id } }); }
  private finish(current: NonNullable<TtsClient['current']>, error?: string) {
    if (this.current !== current) return;
    this.current = null;
    this.sileroPlayer.stop();
    this.webSpeechLipSync.stop();
    this.publisher.send({ type: 'tts_done', payload: { text: current.text, id: current.id, ...(error ? { error } : {}) } });
  }
}
