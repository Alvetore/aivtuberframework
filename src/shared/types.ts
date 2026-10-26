export type Mode = 'reactive' | 'streamer';
export type AvatarMode = 'disabled' | 'internal' | 'vtube-studio';
export type TtsEngine = 'webspeech' | 'silero' | 'openai' | 'elevenlabs';
export type CharacterLanguage = 'ru' | 'en' | 'auto';

export interface ChatMessage {
  id: string;
  twitchId: string;
  username: string;
  message: string;
  timestamp: string;
  badges: string[];
}

export interface Settings {
  twitchUsername: string;
  twitchChannel: string;
  twitchOauthToken: string;
  characterName: string;
  characterPrompt: string;
  characterLanguage: CharacterLanguage;
  responseStyle: string;
  mode: Mode;
  contextMessageLimit: number;
  idleTimeoutSeconds: number;
  responseCooldownSeconds: number;
  maxResponsesPerMinute: number;
  llmEndpoint: string;
  llmApiKey: string;
  llmModel: string;
  temperature: number;
  maxTokens: number;
  ttsEnabled: boolean;
  ttsVoice: string;
  ttsEngine: TtsEngine;
  ttsLanguage?: string;
  ttsVolume?: number;
  audioOutputDeviceId?: string;
  sileroEndpoint: string;
  sileroSpeaker: string;
  sileroSampleRate: number;
  openaiTtsEndpoint?: string;
  openaiTtsApiKey?: string;
  openaiTtsModel?: string;
  openaiTtsVoice?: string;
  elevenlabsApiKey?: string;
  elevenlabsVoiceId?: string;
  elevenlabsModel?: string;
  avatarMode: AvatarMode;
  vtubeStudioUrl: string;
  live2dModelPath?: string;
  live2dScale?: number;
  live2dOffsetX?: number;
  live2dOffsetY?: number;
  overlayClean?: boolean;
  avatarBackground?: 'transparent' | 'chroma-green' | 'chroma-blue' | 'chroma-magenta';
}

export const defaultSettings: Settings = {
  twitchUsername: '', twitchChannel: '', twitchOauthToken: '',
  characterName: 'VTuber', characterPrompt: 'Виртуальная ведущая стрима.', characterLanguage: 'ru', responseStyle: 'Коротко, дружелюбно и естественно.',
  mode: 'reactive', contextMessageLimit: 30, idleTimeoutSeconds: 45, responseCooldownSeconds: 10, maxResponsesPerMinute: 6,
  llmEndpoint: 'https://api.openai.com/v1', llmApiKey: '', llmModel: 'gpt-4o-mini', temperature: 0.8, maxTokens: 180,
  ttsEnabled: true, ttsVoice: '', ttsEngine: 'webspeech', ttsLanguage: 'ru-RU', ttsVolume: 1, audioOutputDeviceId: '', sileroEndpoint: 'http://127.0.0.1:5000', sileroSpeaker: 'xenia', sileroSampleRate: 48000,
  openaiTtsEndpoint: 'https://api.openai.com/v1/audio/speech', openaiTtsApiKey: '', openaiTtsModel: 'tts-1', openaiTtsVoice: 'nova',
  elevenlabsApiKey: '', elevenlabsVoiceId: '21m00Tcm4TlvDq8ikWAM', elevenlabsModel: 'eleven_multilingual_v2',
  avatarMode: 'disabled', vtubeStudioUrl: 'ws://127.0.0.1:8001',
  live2dModelPath: '', live2dScale: 1.0, live2dOffsetX: 0, live2dOffsetY: 0, overlayClean: true, avatarBackground: 'transparent',
};

export interface Status { twitch: 'connected' | 'disconnected'; llm: 'ready' | 'unconfigured'; tts: 'speaking' | 'idle' | 'disabled'; avatar: 'connected' | 'disabled' | 'disconnected'; }
export interface LogEntry { id: string; time: string; level: 'info' | 'error'; source: string; message: string; }
