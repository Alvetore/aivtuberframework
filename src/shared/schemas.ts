import { z } from 'zod';

export const SettingsSchema = z.object({
  twitchUsername: z.string(),
  twitchChannel: z.string(),
  twitchOauthToken: z.string(),
  characterName: z.string().min(1).max(64),
  characterPrompt: z.string().max(4000),
  characterLanguage: z.enum(['ru', 'en', 'auto']).default('ru'),
  responseStyle: z.string().max(1000),
  mode: z.enum(['reactive', 'streamer']),
  contextMessageLimit: z.number().int().min(1).max(200),
  idleTimeoutSeconds: z.number().int().min(5).max(3600),
  responseCooldownSeconds: z.number().int().min(0).max(300),
  maxResponsesPerMinute: z.number().int().min(1).max(60),
  llmEndpoint: z.string().url(),
  llmApiKey: z.string(),
  llmModel: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(1).max(8192),
  ttsEnabled: z.boolean(),
  ttsVoice: z.string(),
  ttsLanguage: z.string().max(35),
  ttsVolume: z.number().min(0).max(1),
  audioOutputDeviceId: z.string().max(512),
  ttsEngine: z.enum(['webspeech', 'silero', 'openai', 'elevenlabs']),
  sileroEndpoint: z.string(),
  sileroSpeaker: z.string(),
  sileroSampleRate: z.number().int().min(8000).max(96000),
  openaiTtsEndpoint: z.string().optional(),
  openaiTtsApiKey: z.string().optional(),
  openaiTtsModel: z.string().optional(),
  openaiTtsVoice: z.string().optional(),
  elevenlabsApiKey: z.string().optional(),
  elevenlabsVoiceId: z.string().optional(),
  elevenlabsModel: z.string().optional(),
  avatarMode: z.enum(['disabled', 'internal', 'vtube-studio']),
  vtubeStudioUrl: z.string(),
  live2dModelPath: z.string().optional(),
  live2dScale: z.number().min(0.1).max(10).optional(),
  live2dOffsetX: z.number().min(-100).max(100),
  live2dOffsetY: z.number().min(-100).max(100),
  overlayClean: z.boolean(),
  avatarBackground: z.enum(['transparent', 'chroma-green', 'chroma-blue', 'chroma-magenta']).optional(),
}).partial();

export const SettingsPutSchema = SettingsSchema;

export const TestMessageSchema = z.object({
  text: z.string().min(1).max(500),
});

export const TwitchConnectSchema = z.object({
  channel: z.string().optional(),
}).optional();
