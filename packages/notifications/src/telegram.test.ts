import { describe, expect, it } from 'vitest';
import { sendTelegramMessage, TelegramDeliveryError } from './telegram';

describe('telegram adapter', () => {
  it('posts a message through the injected transport without leaking the token in errors', async () => {
    const calls: string[] = [];
    await sendTelegramMessage('123', 'hello', {
      botToken: 'secret-token',
      apiBaseUrl: 'https://telegram.test',
      transport: async (url, init) => {
        calls.push(url);
        expect(init.body).toContain('hello');
        expect(init.body).not.toContain('secret-token');
        return { ok: true, status: 200, bodyText: '{}' };
      }
    });
    expect(calls).toEqual(['https://telegram.test/botsecret-token/sendMessage']);
  });

  it('classifies 5xx Telegram failures as retryable', async () => {
    try {
      await sendTelegramMessage('123', 'hello', {
        botToken: 'secret-token',
        transport: async () => ({ ok: false, status: 500, bodyText: 'nope' })
      });
      throw new Error('expected TelegramDeliveryError');
    } catch (error) {
      expect(error).toBeInstanceOf(TelegramDeliveryError);
      expect(error).toMatchObject({ retryable: true });
    }
  });
});
