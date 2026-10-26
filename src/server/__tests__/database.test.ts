import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase } from '../database.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChatMessage } from '../../shared/types.js';

describe('AppDatabase', () => {
  let db: AppDatabase;
  const testDbPath = join(tmpdir(), `vtuber_test_${Date.now()}_${Math.random().toString(36).substring(7)}.sqlite`);

  beforeEach(() => {
    db = new AppDatabase(testDbPath);
  });

  afterEach(() => {
    try {
      db.raw().close();
      if (existsSync(testDbPath)) {
        unlinkSync(testDbPath);
      }
    } catch {
      // ignore cleanup errors
    }
  });

  it('initializes Drizzle ORM and tables', () => {
    expect(db.orm()).toBeDefined();
    expect(db.raw()).toBeDefined();
  });

  it('manages sessions and session message counts', () => {
    const sessionId = db.startSession();
    expect(sessionId).toBeGreaterThan(0);
    db.currentSessionId = sessionId;

    const chatMsg: ChatMessage = {
      id: 'msg-1',
      twitchId: 'user-1',
      username: 'Alice',
      message: 'Привет!',
      timestamp: new Date().toISOString(),
      badges: [],
    };

    db.recordChat(chatMsg);
    expect(db.messageCountInSession).toBe(1);

    db.endSession(sessionId, db.messageCountInSession);
  });

  it('tracks viewers and message counts accurately', () => {
    const chatMsg1: ChatMessage = {
      id: 'msg-1',
      twitchId: 'viewer_100',
      username: 'Alice',
      message: 'Привет!',
      timestamp: '2026-01-01T12:00:00.000Z',
      badges: [],
    };

    db.recordChat(chatMsg1);

    const viewer = db.viewer('viewer_100') as any;
    expect(viewer).toBeDefined();
    expect(viewer.username).toBe('Alice');
    expect(viewer.message_count).toBe(1);

    // Second message from same viewer
    const chatMsg2: ChatMessage = {
      id: 'msg-2',
      twitchId: 'viewer_100',
      username: 'AliceInWonderland',
      message: 'Второе сообщение',
      timestamp: '2026-01-01T12:05:00.000Z',
      badges: [],
    };
    db.recordChat(chatMsg2);

    const updated = db.viewer('viewer_100') as any;
    expect(updated.username).toBe('AliceInWonderland');
    expect(updated.message_count).toBe(2);
  });

  it('records chat history and bot responses, supporting excludeBot option', () => {
    const userMsg: ChatMessage = {
      id: 'msg-user-1',
      twitchId: 'user_bob',
      username: 'Bob',
      message: 'Какая сегодня погода?',
      timestamp: '2026-01-01T12:00:00.000Z',
      badges: [],
    };
    db.recordChat(userMsg);

    const botMsgId = db.recordBotResponse('Сегодня отличная солнечная погода!');
    expect(botMsgId).toBeDefined();

    // Context including bot responses
    const allContext = db.context(10, { excludeBot: false });
    expect(allContext.length).toBe(2);
    expect(allContext[0].username).toBe('Bob');
    expect(allContext[0].isBotResponse).toBe(false);
    expect(allContext[1].username).toBe('bot');
    expect(allContext[1].isBotResponse).toBe(true);
    expect(allContext[1].message).toBe('Сегодня отличная солнечная погода!');

    // Context excluding bot responses
    const userOnlyContext = db.context(10, { excludeBot: true });
    expect(userOnlyContext.length).toBe(1);
    expect(userOnlyContext[0].username).toBe('Bob');
  });

  it('saves and loads settings properly', () => {
    db.saveSettings({
      characterName: 'МояВтуберша',
      characterLanguage: 'en',
    });

    const settings = db.getSettings();
    expect(settings.characterName).toBe('МояВтуберша');
    expect(settings.characterLanguage).toBe('en');
  });
});
