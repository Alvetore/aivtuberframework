import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase } from '../database.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChatMessage } from '../../shared/types.js';
import type { Operation } from '../../shared/product.js';

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

  it('initializes the SQLite schema', () => {
    expect(db.raw()).toBeDefined();
    expect(db.raw().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('messages','sessions','settings','viewers')").all()).toHaveLength(4);
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

  it('aggregates session operation stats', () => {
    const sessionId = db.startSession();
    const op = (id: string, usage?: Operation['usage']): Operation => ({
      id, author: 'Alice', prompt: 'вопрос', profileId: db.activeProfileId(), sessionId,
      source: 'twitch', stage: 'finished', outcome: 'completed', createdAt: new Date().toISOString(), usage,
    });
    db.saveOperation(op('op-1', { promptTokens: 10, completionTokens: 5, totalTokens: 15 }));
    db.saveOperation(op('op-2', { promptTokens: 10, completionTokens: 5, totalTokens: 15 }));

    const summary = () => db.sessions().items.find(s => s.id === sessionId)!;
    expect(summary().operationCount).toBe(2);
    expect(summary().totalTokens).toBe(30);

    // An operation without a numeric total invalidates the whole sum.
    db.saveOperation(op('op-3', { promptTokens: 1, completionTokens: 1, totalTokens: null }));
    expect(summary().operationCount).toBe(3);
    expect(summary().totalTokens).toBeNull();

    const emptySession = db.startSession();
    const empty = db.sessions().items.find(s => s.id === emptySession)!;
    expect(empty.operationCount).toBe(0);
    expect(empty.totalTokens).toBeNull();
  });

  it('marks a missing session as not found', () => {
    let error: unknown;
    try { db.sessionDetail(9999); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ statusCode: 404 });
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
