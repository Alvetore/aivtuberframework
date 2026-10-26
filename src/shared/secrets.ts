export const secretKeys = ['twitchOauthToken', 'llmApiKey', 'openaiTtsApiKey', 'elevenlabsApiKey'] as const;
export type SecretKey = typeof secretKeys[number];
export type SecretValues = Record<SecretKey, string>;
export const secretEnvironment: Record<SecretKey, string> = {
  twitchOauthToken: 'TWITCH_OAUTH_TOKEN', llmApiKey: 'LLM_API_KEY',
  openaiTtsApiKey: 'OPENAI_TTS_API_KEY', elevenlabsApiKey: 'ELEVENLABS_API_KEY',
};
