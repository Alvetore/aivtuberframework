import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationEngine } from '../conversation.js';
import { EventBus } from '../event-bus.js';
import { OpenAICompatibleProvider } from '../llm.js';
import { AppDatabase } from '../database.js';
import { defaultSettings, type Settings } from '../../shared/types.js';

const message = { twitchId: 'review-user', username: 'Reviewer', message: 'How are you?' };
const databases:AppDatabase[]=[];

function fixture(settings: Partial<Settings>, llm: OpenAICompatibleProvider) {
  const db = new AppDatabase(':memory:');databases.push(db);
  const recordBotResponse = vi.spyOn(db,'recordBotResponse');
  const bus = new EventBus();
  const responses: string[] = [];
  bus.on('LLM_RESPONSE', ({ text }) => responses.push(text));
  const engine = new ConversationEngine(db, llm, bus, () => ({ ...defaultSettings,llmApiKey:'fake-review-key',ttsEnabled:false, ...settings }));
  engine.command('start');
  return { engine, responses, recordBotResponse, bus };
}

describe('ConversationEngine response limits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
  });

  afterEach(() => {
    for(const db of databases.splice(0))db.raw().close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    { responseCooldownSeconds: 10, maxResponsesPerMinute: 60, wait: 10_000 },
    { responseCooldownSeconds: 0, maxResponsesPerMinute: 1, wait: 60_000 },
  ])('counts limits from completion after a 61-second generation: %j', async ({ wait, ...settings }) => {
    const chat = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({text:'First'}), 61_000)))
      .mockResolvedValue({text:'Second'});
    const { engine, responses } = fixture(settings, { chatWithUsage:chat } as unknown as OpenAICompatibleProvider);

    const first = engine.onMessage(message);
    await vi.advanceTimersByTimeAsync(61_000);
    await first;
    await engine.onMessage(message);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(responses).toEqual(['First']);

    await vi.advanceTimersByTimeAsync(wait - 1);
    await engine.onMessage(message);
    expect(chat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await engine.onMessage(message);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(responses).toEqual(['First', 'Second']);
  });

  it('releases busy state after exhausted body timeouts and accepts the next message', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: () => new Promise<never>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { engine, responses, bus } = fixture({ llmApiKey: 'fake-review-key' }, new OpenAICompatibleProvider());
    const errors: string[] = [];
    bus.on('LOG', ({ message }) => errors.push(message));

    const failed = engine.onMessage(message);
    await vi.runAllTimersAsync();
    await failed;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(errors).toEqual(['LLM таймаут после 30000ms']);
    expect(responses).toEqual([]);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Recovered' } }] }),
    })));
    await engine.onMessage(message);
    expect(responses).toEqual(['Recovered']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
