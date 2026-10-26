import { z } from 'zod';

export const CharacterFormSchema = z.object({
  characterName: z.string().min(1, 'Имя обязательно').max(64),
  characterPrompt: z.string().max(4000, 'Слишком длинное описание'),
  characterLanguage: z.enum(['ru', 'en', 'auto']),
  responseStyle: z.string().max(1000),
});
export type CharacterFormData = z.infer<typeof CharacterFormSchema>;

export const LlmFormSchema = z.object({
  llmEndpoint: z.string().url('Некорректный URL endpoint'),
  llmApiKey: z.string(),
  llmModel: z.string().min(1, 'Модель обязательна'),
  temperature: z.coerce.number().min(0).max(2),
  maxTokens: z.coerce.number().int().min(1).max(8192),
});
export type LlmFormData = z.infer<typeof LlmFormSchema>;

export const BehaviorFormSchema = z.object({
  mode: z.enum(['reactive', 'streamer']),
  contextMessageLimit: z.coerce.number().int().min(1).max(200),
  idleTimeoutSeconds: z.coerce.number().int().min(5).max(3600),
  responseCooldownSeconds: z.coerce.number().int().min(0).max(300),
  maxResponsesPerMinute: z.coerce.number().int().min(1).max(60),
});
export type BehaviorFormData = z.infer<typeof BehaviorFormSchema>;

export const TwitchFormSchema = z.object({
  twitchUsername: z.string().min(1, 'Логин обязателен'),
  twitchChannel: z.string().min(1, 'Канал обязателен'),
  twitchOauthToken: z.string(),
});
export type TwitchFormData = z.infer<typeof TwitchFormSchema>;

export const TtsFormSchema = z.object({
  ttsEnabled: z.boolean(),
  ttsVoice: z.string(),
  ttsLanguage: z.string().max(35),
  ttsVolume: z.coerce.number().min(0).max(1),
  audioOutputDeviceId: z.string(),
  ttsEngine: z.enum(['webspeech', 'silero', 'openai', 'elevenlabs']),
  sileroEndpoint: z.string(),
  sileroSpeaker: z.string(),
  sileroSampleRate: z.coerce.number().int().min(8000).max(96000),
  openaiTtsEndpoint: z.string().optional(),
  openaiTtsApiKey: z.string().optional(),
  openaiTtsModel: z.string().optional(),
  openaiTtsVoice: z.string().optional(),
  elevenlabsApiKey: z.string().optional(),
  elevenlabsVoiceId: z.string().optional(),
  elevenlabsModel: z.string().optional(),
});
export type TtsFormData = z.infer<typeof TtsFormSchema>;

export const AvatarFormSchema = z.object({
  avatarMode: z.enum(['disabled', 'internal', 'vtube-studio']),
  vtubeStudioUrl: z.string(),
  live2dModelPath: z.string().optional(),
  live2dScale: z.coerce.number().min(0.1).max(10).optional(),
  live2dOffsetX: z.coerce.number().min(-100).max(100),
  live2dOffsetY: z.coerce.number().min(-100).max(100),
  overlayClean: z.boolean(),
  avatarBackground: z.enum(['transparent', 'chroma-green', 'chroma-blue', 'chroma-magenta']).optional(),
});
export type AvatarFormData = z.infer<typeof AvatarFormSchema>;
