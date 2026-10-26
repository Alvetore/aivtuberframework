import type { Settings } from '../shared/types.js';
import { redactSecrets } from './redact.js';

export interface LlmMessage { role: 'system' | 'user' | 'assistant'; content: string; }
export interface LlmUsage { promptTokens: number|null; completionTokens: number|null; totalTokens: number|null; }
export interface LlmResult { text: string; usage?: LlmUsage; attempts?: number; }

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1_000;

export class OpenAICompatibleProvider {
  private totalUsage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  getUsage(): LlmUsage { return { ...this.totalUsage }; }

  async chat(settings: Settings, messages: LlmMessage[], signal?: AbortSignal): Promise<string> {
    const result = await this.chatWithUsage(settings, messages, signal);
    return result.text;
  }

  async chatWithUsage(settings: Settings, messages: LlmMessage[], signal?: AbortSignal): Promise<LlmResult> {
    if (!settings.llmApiKey || !settings.llmModel) throw new Error('LLM не настроена: укажите API key и модель.');
    const url = `${settings.llmEndpoint.replace(/\/$/, '')}/chat/completions`;
    const body = JSON.stringify({
      model: settings.llmModel,
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
    });
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      signal?.throwIfAborted();
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', abort, {once:true});
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.llmApiKey}` },
          body,
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json() as {
            choices?: { message?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          };
          const text = data.choices?.[0]?.message?.content?.trim();
          if (!text) throw new Error('LLM вернула пустой ответ.');
          let usage: LlmUsage | undefined;
          if (data.usage) {
            const token = (value:unknown) => typeof value==='number' && Number.isFinite(value) && value>=0 ? value : null;
            usage = {
              promptTokens: token(data.usage.prompt_tokens),
              completionTokens: token(data.usage.completion_tokens),
              totalTokens: token(data.usage.total_tokens),
            };
            this.totalUsage.promptTokens = (this.totalUsage.promptTokens??0)+(usage.promptTokens??0);
            this.totalUsage.completionTokens = (this.totalUsage.completionTokens??0)+(usage.completionTokens??0);
            this.totalUsage.totalTokens = (this.totalUsage.totalTokens??0)+(usage.totalTokens??0);
          }
          return { text, usage, attempts:attempt+1 };
        }
        throw new Error(`LLM вернула ${response.status}: ${redactSecrets(await response.text())}`);
      } catch (e) {
        signal?.throwIfAborted();
        const errMsg = e instanceof Error ? e.message : String(e);
        if (/LLM вернула 4(?!29)\d\d:/.test(errMsg)) {
          throw e instanceof Error ? e : new Error(errMsg);
        }
        if (e instanceof Error && e.name === 'AbortError') {
          lastError = new Error(`LLM таймаут после ${REQUEST_TIMEOUT_MS}ms`);
        } else {
          lastError = e instanceof Error ? e : new Error(String(e));
        }
        if (attempt >= MAX_RETRIES) { Object.assign(lastError,{attempts:attempt+1}); throw lastError; }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
      await new Promise<void>((resolve,reject) => {
        const abort = () => {clearTimeout(timer);reject(signal?.reason ?? new DOMException('Cancelled','AbortError'));};
        const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},RETRY_BASE_MS*(attempt+1));
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted) abort();
      });
    }
    throw lastError ?? new Error('LLM неизвестная ошибка');
  }
}
