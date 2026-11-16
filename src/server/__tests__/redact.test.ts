import { describe, expect, it } from 'vitest';
import { redactOauth, redactSecrets } from '../redact.js';

describe('redactSecrets', () => {
  it('removes known secret values from messages', () => {
    expect(redactSecrets('Ключ sk-abcdefgh12345678 отклонён', ['sk-abcdefgh12345678'])).toBe('Ключ *** отклонён');
  });

  it('ignores short values that would over-redact ordinary text', () => {
    expect(redactSecrets('Ошибка в строке 123', ['123'])).toBe('Ошибка в строке 123');
  });

  it('ignores the mask placeholder', () => {
    expect(redactSecrets('Поле содержит ***', ['***'])).toBe('Поле содержит ***');
  });

  it('still masks bearer tokens and api keys by pattern', () => {
    expect(redactSecrets('Authorization: Bearer abcdef1234567890')).toBe('Authorization: Bearer ***');
    expect(redactSecrets('{"api_key":"abcdef1234567890"}')).toBe('{"api_key":"***"}');
  });
});

describe('redactOauth', () => {
  it('masks the middle of a long token', () => {
    expect(redactOauth('oauth:abcdef123456')).toBe('oaut***3456');
  });

  it('fully hides short tokens', () => {
    expect(redactOauth('short')).toBe('***');
  });
});
