import { sendTelegramMessage, TelegramDeliveryError } from '@ara/notifications';
import type { Json } from '@ara/db';
import type { QueueDatabaseClient } from '@ara/queue';
import type { Locale } from '@ara/shared';

export type LifecycleNotificationInput = {
  readonly candidateId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly analysisVerdict?: string;
  readonly locale: Locale;
};

export type NotificationStore = {
  insertNotification(input: {
    readonly candidateId: string;
    readonly eventType: string;
    readonly idempotencyKey: string;
    readonly payload: Record<string, unknown>;
    readonly locale: string;
  }): Promise<'inserted' | 'duplicate'>;
  deliver(text: string, idempotencyKey: string): Promise<void>;
};

function eventFor(input: LifecycleNotificationInput): string | null {
  if (input.toState === 'Needs Attention' && input.fromState !== 'Needs Attention') {
    return 'NEEDS_ATTENTION';
  }
  const isStrong =
    input.analysisVerdict === 'strong_potential' || input.toState === 'Strong';
  if (!isStrong) {
    return null;
  }
  return input.fromState === 'Watch' ? 'WATCH_TO_STRONG' : 'NEW_STRONG';
}

function summaryFor(eventType: string, candidateId: string): string {
  if (eventType === 'NEW_STRONG') {
    return `NEW_STRONG ${candidateId}`;
  }
  if (eventType === 'WATCH_TO_STRONG') {
    return `WATCH_TO_STRONG ${candidateId}`;
  }
  return `NEEDS_ATTENTION ${candidateId}`;
}

export async function recordCandidateLifecycleNotification(
  store: NotificationStore,
  input: LifecycleNotificationInput
): Promise<string | null> {
  const eventType = eventFor(input);
  if (!eventType) {
    return null;
  }
  const payload = {
    candidateId: input.candidateId,
    fromState: input.fromState,
    toState: input.toState,
    eventType,
    summary: summaryFor(eventType, input.candidateId)
  };
  const idempotencyKey = `${eventType}:${input.candidateId}`;
  const inserted = await store.insertNotification({
    candidateId: input.candidateId,
    eventType,
    idempotencyKey,
    payload,
    locale: input.locale
  });
  if (inserted === 'inserted') {
    try {
      await store.deliver(payload.summary, idempotencyKey);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
  }
  return eventType;
}

export function createSupabaseNotificationStore(
  client: QueueDatabaseClient,
  options: {
    readonly locale: Locale;
    readonly transport?: Parameters<typeof sendTelegramMessage>[2]['transport'];
    readonly botToken?: string;
  } = { locale: 'ko' }
): NotificationStore {
  return {
    async insertNotification(input) {
      const { error } = await client.from('notifications').insert({
        candidate_id: input.candidateId,
        event_type: input.eventType,
        idempotency_key: input.idempotencyKey,
        payload: JSON.parse(JSON.stringify(input.payload)) as Json,
        locale: input.locale,
        status: 'queued'
      });
      if (error?.code === '23505') {
        return 'duplicate';
      }
      if (error) {
        throw new Error(`Could not persist notification: ${error.message}`);
      }
      return 'inserted';
    },
    async deliver(text, idempotencyKey) {
      const { data: settings, error } = await client
        .from('app_settings')
        .select('telegram_enabled,telegram_chat_id,notification_locale,locale')
        .eq('id', true)
        .maybeSingle();
      if (error) {
        throw new Error(`Could not read notification settings: ${error.message}`);
      }
      if (!settings?.telegram_enabled || !settings.telegram_chat_id) {
        return;
      }
      const token = options.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '';
      try {
        await sendTelegramMessage(settings.telegram_chat_id, text, {
          botToken: token,
          ...(options.transport ? { transport: options.transport } : {})
        });
        await client
          .from('notifications')
          .update({
            status: 'delivered',
            delivered_at: new Date().toISOString()
          })
          .eq('idempotency_key', idempotencyKey);
      } catch (error) {
        const retryable = error instanceof TelegramDeliveryError ? error.retryable : true;
        await client
          .from('notifications')
          .update({
            status: retryable ? 'retryable' : 'failed',
            last_error: 'telegram_delivery_failed'
          })
          .eq('idempotency_key', idempotencyKey);
        if (!(error instanceof Error)) {
          throw error;
        }
      }
    }
  };
}

export async function notifyCandidateDecision(
  client: QueueDatabaseClient,
  input: LifecycleNotificationInput
): Promise<string | null> {
  return recordCandidateLifecycleNotification(
    createSupabaseNotificationStore(client, { locale: input.locale }),
    input
  );
}
