import { describe, expect, it } from 'vitest';
import { formatLog } from './logger';

describe('structured logger', () => {
  it('redacts known secret field names recursively', () => {
    const line = formatLog({
      apiKey: 'abc',
      authorization: 'AI:secret',
      nested: { token: 'xyz' }
    });
    expect(line).not.toContain('abc');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('xyz');
    expect(line).toContain('[REDACTED]');
  });

  it('redacts Telegram bot tokens inside URL strings', () => {
    const line = formatLog({
      url: 'https://api.telegram.org/bot123456:AAExampleToken/sendMessage',
      ciphertext: 'encrypted-provider-key'
    });
    expect(line).not.toContain('AAExampleToken');
    expect(line).not.toContain('encrypted-provider-key');
    expect(line).toContain('[REDACTED_URL]');
    expect(line).toContain('[REDACTED]');
  });
});
