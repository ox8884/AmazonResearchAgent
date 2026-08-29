export type TelegramTransport = (
  url: string,
  init: RequestInit
) => Promise<{ readonly ok: boolean; readonly status: number; readonly bodyText: string }>;

export class TelegramDeliveryError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, cause?: unknown) {
    super(message, { cause });
    this.name = 'TelegramDeliveryError';
    this.retryable = retryable;
  }
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options: {
    readonly botToken: string;
    readonly apiBaseUrl?: string;
    readonly transport?: TelegramTransport;
  }
): Promise<void> {
  if (options.botToken.length === 0) {
    throw new TelegramDeliveryError('Telegram bot token is missing.', false);
  }
  const transport =
    options.transport ??
    (async (url, init) => {
      const response = await fetch(url, init);
      return {
        ok: response.ok,
        status: response.status,
        bodyText: await response.text()
      };
    });
  const apiBaseUrl = (options.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/+$/u, '');
  const result = await transport(`${apiBaseUrl}/bot${options.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  });
  if (result.ok) {
    return;
  }
  throw new TelegramDeliveryError(
    `Telegram delivery failed with status ${result.status}.`,
    result.status >= 500 || result.status === 429
  );
}
