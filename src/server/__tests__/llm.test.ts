import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleProvider } from '../llm.js';
import { defaultSettings } from '../../shared/types.js';

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider;

  beforeEach(() => {
    provider = new OpenAICompatibleProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('throws immediately if API key or model is missing', async () => {
    const settings = { ...defaultSettings, llmApiKey: '', llmModel: '' };
    await expect(provider.chat(settings, [{ role: 'user', content: 'hi' }])).rejects.toThrow('LLM не настроена');
  });

  it('does NOT retry on 401 Unauthorized client errors', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: false,
        status: 401,
        text: async () => 'Invalid API Key',
      };
    }));

    const settings = { ...defaultSettings, llmApiKey: 'invalid_key', llmModel: 'gpt-4o' };
    await expect(provider.chat(settings, [{ role: 'user', content: 'hi' }])).rejects.toThrow('LLM вернула 401');
    expect(callCount).toBe(1); // Exactly 1 call, no retries!
  });

  it('successfully returns text and tracks cumulative token usage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Привет! Я готова к стриму.' } }],
          usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
        }),
      };
    }));

    const settings = { ...defaultSettings, llmApiKey: 'sk-test', llmModel: 'gpt-4o' };
    const res = await provider.chatWithUsage(settings, [{ role: 'user', content: 'Привет!' }]);

    expect(res.text).toBe('Привет! Я готова к стриму.');
    expect(res.usage?.totalTokens).toBe(23);

    const usage = provider.getUsage();
    expect(usage.totalTokens).toBe(23);
    expect(usage.promptTokens).toBe(15);
    expect(usage.completionTokens).toBe(8);
  });

  it.each([200, 500])('times out stalled response bodies with HTTP %s and cleans up each retry', async (status) => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const signal = init.signal!;
      signals.push(signal);
      const read = () => new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
      return { ok: status === 200, status, json: read, text: read };
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = provider.chat({ ...defaultSettings, llmApiKey: 'fake-review-key' }, []);
    const rejected = expect(result).rejects.toThrow('LLM таймаут после 30000ms');

    await vi.runAllTimersAsync();
    await rejected;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timeout after consuming a successful response', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal!;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Ready' } }] }) };
    }));

    await expect(provider.chat({ ...defaultSettings, llmApiKey: 'fake-review-key' }, [])).resolves.toBe('Ready');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('external cancellation aborts body consumption and does not retry',async()=>{
    let bodyStarted!:()=>void;const started=new Promise<void>(resolve=>{bodyStarted=resolve;});
    const fetchMock=vi.fn(async(_url,init)=>({ok:true,json:()=>{bodyStarted();return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}}));
    vi.stubGlobal('fetch',fetchMock);const controller=new AbortController();
    const request=provider.chatWithUsage({...defaultSettings,llmApiKey:'fake'},[],controller.signal);const rejected=expect(request).rejects.toThrow();
    await started;controller.abort();await rejected;expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
