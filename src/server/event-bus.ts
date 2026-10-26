import { EventEmitter } from 'node:events';
import type { ChatMessage } from '../shared/types.js';

export interface Events {
  CHAT_MESSAGE: ChatMessage;
  VIEWER_JOIN: { twitchId: string; username: string };
  LLM_REQUEST: { prompt: string };
  LLM_RESPONSE: { text: string; operationId?: string };
  WORKSPACE_CHANGED: undefined;
  TTS_START: { text: string; engine: string };
  TTS_END: undefined;
  TWITCH_CONNECTED: undefined;
  TWITCH_DISCONNECTED: undefined;
  AVATAR_CONNECTED: undefined;
  AVATAR_DISCONNECTED: undefined;
  LIPSYNC_UPDATE: { value: number };
  LOG: { level: 'info' | 'error'; source: string; message: string };
}

export class EventBus {
  private emitter = new EventEmitter();
  on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void) { this.emitter.on(event, listener); }
  emit<K extends keyof Events>(event: K, value: Events[K]) { this.emitter.emit(event, value); }
}
