import { z } from 'zod';
import { SettingsSchema } from './schemas';
import type { Settings, Status, LogEntry } from './types';

// Connections, credentials, output devices and file paths never travel in a profile.
export const profileKeys = ['characterName','characterPrompt','characterLanguage','responseStyle','mode','contextMessageLimit','idleTimeoutSeconds','responseCooldownSeconds','maxResponsesPerMinute','ttsEnabled','ttsVoice','ttsEngine','ttsLanguage','ttsVolume','sileroSpeaker','sileroSampleRate','openaiTtsModel','openaiTtsVoice','elevenlabsVoiceId','elevenlabsModel','avatarMode','live2dScale','live2dOffsetX','live2dOffsetY','overlayClean','avatarBackground'] as const;
export type ProfileSettings = Pick<Settings, typeof profileKeys[number]>;
const profileShape = Object.fromEntries(profileKeys.map(key => [key, SettingsSchema.shape[key]])) as Pick<typeof SettingsSchema.shape, typeof profileKeys[number]>;
export const ProfileSettingsSchema = z.object(profileShape).required().strict();
export const ProfileFileSchema = z.object({ version: z.literal(1), name: z.string().trim().min(1).max(64), settings: ProfileSettingsSchema }).strict();
export type ProfileFile = z.infer<typeof ProfileFileSchema>;
export interface Profile { id: string; name: string; settings: ProfileSettings; createdAt: string; }
export function pickProfileSettings(settings: Settings): ProfileSettings { return Object.fromEntries(profileKeys.map(key => [key, settings[key]])) as ProfileSettings; }

export const RuntimeCommandSchema = z.enum(['start','pause','resume','stop','interrupt','mute','unmute']);
export type RuntimeCommand = z.infer<typeof RuntimeCommandSchema>;
export interface RuntimeState { state: 'stopped'|'running'|'paused'; muted: boolean; reason?: string; sessionId: number|null; profileId: string; cooldownUntil: number; }
export const OperationSchema = z.object({
  id: z.string(), messageId: z.string().optional(), replyId: z.string().optional(), author: z.string(), prompt: z.string(), text: z.string().optional(),
  trigger: z.enum(['message','idle']).optional(),
  profileId: z.string(), sessionId: z.number().nullable(), source: z.enum(['twitch','test']),
  stage: z.enum(['received','generating','synthesizing','queued','speaking','finished']), outcome: z.enum(['pending','completed','skipped','cancelled','failed']),
  reason: z.string().optional(), error: z.string().optional(), retryAfterMs: z.number().optional(), createdAt: z.string(), finishedAt: z.string().optional(),
  llmMs: z.number().optional(), synthesisMs: z.number().optional(), playbackMs: z.number().optional(), attempts: z.number().optional(),
  usage: z.object({promptTokens:z.number().nullable(),completionTokens:z.number().nullable(),totalTokens:z.number().nullable()}).optional(),
});
export type Operation = z.infer<typeof OperationSchema>;
export interface FeedMessage { id: string; username: string; message: string; timestamp: string; isBotResponse: boolean; source: 'twitch'|'test'|'legacy'; profileId?: string; sessionId?: number|null; replyToId?: string; operationId?: string; }
export interface ConnectionCheck { state: 'unconfigured'|'configured'|'checking'|'api_verified'|'response_verified'|'error'; message?: string; checkedAt?: string; }
export interface QueueSnapshot { state: 'speaking'|'idle'; pending: number; text?: string; operationId?: string; }
export interface Snapshot { serverInstanceId: string; seq: number; serverTime: number; settings: Settings; status: Status; runtime: RuntimeState; profiles: Profile[]; feed: FeedMessage[]; operations: Operation[]; queue: QueueSnapshot; logs: LogEntry[]; checks: {llm: ConnectionCheck}; }
export interface SessionSummary { id: number; profileId: string|null; profileName: string|null; startTime: string; endTime: string|null; messageCount: number; legacy: boolean; operationCount: number; totalTokens: number|null; }
export interface SessionDetail { session: SessionSummary; messages: FeedMessage[]; operations: Operation[]; }
export interface PageResult<T> { items: T[]; total: number; offset: number; limit: number; }
export interface ProductEvent { type: string; payload: unknown; serverInstanceId: string; seq: number; }

export const PublicSettingsSchema=SettingsSchema.refine(s=>['twitchOauthToken','llmApiKey','openaiTtsApiKey','elevenlabsApiKey'].every(key=>{const value=s[key as keyof typeof s];return value===undefined||value===''||value==='***';}),'Public settings must not contain credentials');
export const StatusSchema=z.object({twitch:z.enum(['connected','disconnected']),llm:z.enum(['ready','unconfigured']),tts:z.enum(['speaking','idle','disabled']),avatar:z.enum(['connected','disabled','disconnected'])});
export const RuntimeStateSchema=z.object({state:z.enum(['stopped','running','paused']),muted:z.boolean(),reason:z.string().optional(),sessionId:z.number().nullable(),profileId:z.string(),cooldownUntil:z.number()});
export const QueueSchema=z.object({state:z.enum(['speaking','idle']),pending:z.number().int().min(0),text:z.string().optional(),operationId:z.string().optional()});
export const LogSchema=z.object({id:z.string(),time:z.string(),level:z.enum(['info','error']),source:z.string(),message:z.string()});
export const FeedSchema=z.object({id:z.string(),username:z.string(),message:z.string(),timestamp:z.string(),isBotResponse:z.boolean(),source:z.enum(['twitch','test','legacy']),profileId:z.string().optional(),sessionId:z.number().nullable().optional(),replyToId:z.string().optional(),operationId:z.string().optional()});
export const ProfileSchema=z.object({id:z.string(),name:z.string(),settings:ProfileSettingsSchema,createdAt:z.string()});
const CheckSchema=z.object({state:z.enum(['unconfigured','configured','checking','api_verified','response_verified','error']),message:z.string().optional(),checkedAt:z.string().optional()});
export const SnapshotSchema=z.object({serverInstanceId:z.string(),seq:z.number().int().min(0),serverTime:z.number(),settings:PublicSettingsSchema,status:StatusSchema,runtime:RuntimeStateSchema,profiles:ProfileSchema.array(),feed:FeedSchema.array().max(100),operations:OperationSchema.array().max(100),queue:QueueSchema,logs:LogSchema.array().max(200),checks:z.object({llm:CheckSchema})});
