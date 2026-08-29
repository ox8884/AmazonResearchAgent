import {
  renderDailyDigest,
  sendTelegramMessage,
  TelegramDeliveryError,
  type TelegramTransport
} from '@ara/notifications';
import { LocaleSchema } from '@ara/shared';
import type { QueueDatabaseClient } from '@ara/queue';

export async function runSendDigest(
  client: QueueDatabaseClient,
  options: {
    readonly researchRunId?: string;
    readonly transport?: TelegramTransport;
    readonly botToken?: string;
  } = {}
): Promise<{ readonly delivered: number; readonly failed: number }> {
  const { data: settings, error: settingsError } = await client
    .from('app_settings')
    .select('locale,notification_locale,telegram_enabled,telegram_chat_id')
    .eq('id', true)
    .maybeSingle();
  if (settingsError) {
    throw new Error(`Could not read notification settings: ${settingsError.message}`);
  }
  if (!settings?.telegram_enabled || !settings.telegram_chat_id) {
    return { delivered: 0, failed: 0 };
  }

  const locale = LocaleSchema.parse(settings.notification_locale ?? settings.locale);
  const { data: rows, error } = await client
    .from('notifications')
    .select('id,event_type,payload,idempotency_key')
    .in('status', ['queued', 'retryable'])
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) {
    throw new Error(`Could not load notifications: ${error.message}`);
  }

  let delivered = 0;
  let failed = 0;
  const events = (rows ?? []).map((row) => ({
    type: row.event_type,
    summary:
      typeof row.payload === 'object' &&
      row.payload !== null &&
      'summary' in row.payload &&
      typeof row.payload.summary === 'string'
        ? row.payload.summary
        : row.event_type
  }));
  const text = renderDailyDigest({ events }, locale);
  const token = options.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '';
  try {
    await sendTelegramMessage(settings.telegram_chat_id, text, {
      botToken: token,
      ...(options.transport ? { transport: options.transport } : {})
    });
    for (const row of rows ?? []) {
      await client
        .from('notifications')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          locale
        })
        .eq('id', row.id)
        .in('status', ['queued', 'retryable']);
      delivered += 1;
    }
  } catch (error) {
    const retryable = error instanceof TelegramDeliveryError ? error.retryable : true;
    failed = rows?.length ?? 0;
    for (const row of rows ?? []) {
      await client
        .from('notifications')
        .update({
          status: retryable ? 'retryable' : 'failed',
          last_error: 'telegram_delivery_failed'
        })
        .eq('id', row.id);
    }
  }
  return { delivered, failed };
}
