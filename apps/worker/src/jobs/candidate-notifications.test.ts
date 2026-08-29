import { describe, expect, it } from 'vitest';
import {
  recordCandidateLifecycleNotification,
  type NotificationStore
} from './candidate-notifications';

class MemoryNotificationStore implements NotificationStore {
  readonly rows: Array<{
    candidateId: string;
    eventType: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }> = [];
  deliveries: string[] = [];
  failDelivery = false;
  candidateState = 'Watch';

  async insertNotification(input: {
    readonly candidateId: string;
    readonly eventType: string;
    readonly idempotencyKey: string;
    readonly payload: Record<string, unknown>;
    readonly locale: string;
  }): Promise<'inserted' | 'duplicate'> {
    if (this.rows.some((row) => row.idempotencyKey === input.idempotencyKey)) {
      return 'duplicate';
    }
    this.rows.push({
      candidateId: input.candidateId,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload
    });
    return 'inserted';
  }

  async deliver(text: string, _idempotencyKey: string): Promise<void> {
    void _idempotencyKey;
    if (this.failDelivery) {
      throw new Error('telegram down');
    }
    this.deliveries.push(text);
  }
}

const CANDIDATE = '00000000-0000-4000-8000-0000000000aa';

describe('candidate lifecycle notifications', () => {
  it('records NEW_STRONG once for a first-time Strong verdict outside Watch', async () => {
    const store = new MemoryNotificationStore();
    await recordCandidateLifecycleNotification(store, {
      candidateId: CANDIDATE,
      fromState: 'Needs Review',
      toState: 'Watch',
      analysisVerdict: 'strong_potential',
      locale: 'ko'
    });
    await recordCandidateLifecycleNotification(store, {
      candidateId: CANDIDATE,
      fromState: 'Needs Review',
      toState: 'Watch',
      analysisVerdict: 'strong_potential',
      locale: 'ko'
    });
    expect(store.rows.map((row) => row.eventType)).toEqual(['NEW_STRONG']);
    expect(store.deliveries).toHaveLength(1);
    expect(JSON.stringify(store.rows[0]?.payload)).not.toMatch(/token|authorization|password/iu);
  });

  it('records WATCH_TO_STRONG once when Watch receives a Strong verdict', async () => {
    const store = new MemoryNotificationStore();
    await recordCandidateLifecycleNotification(store, {
      candidateId: CANDIDATE,
      fromState: 'Watch',
      toState: 'Watch',
      analysisVerdict: 'strong_potential',
      locale: 'ko'
    });
    await recordCandidateLifecycleNotification(store, {
      candidateId: CANDIDATE,
      fromState: 'Watch',
      toState: 'Watch',
      analysisVerdict: 'strong_potential',
      locale: 'ko'
    });
    expect(store.rows.map((row) => row.eventType)).toEqual(['WATCH_TO_STRONG']);
  });

  it('records NEEDS_ATTENTION from durable attention state without retry spam', async () => {
    const store = new MemoryNotificationStore();
    await recordCandidateLifecycleNotification(store, {
      candidateId: CANDIDATE,
      fromState: 'Watch',
      toState: 'Needs Attention',
      locale: 'ko'
    });
    await recordCandidateLifecycleNotification(store, {
      candidateId: CANDIDATE,
      fromState: 'Watch',
      toState: 'Needs Attention',
      locale: 'ko'
    });
    expect(store.rows.map((row) => row.eventType)).toEqual(['NEEDS_ATTENTION']);
  });

  it('does not roll back candidate state when Telegram delivery fails', async () => {
    const store = new MemoryNotificationStore();
    store.failDelivery = true;
    store.candidateState = 'Watch';
    await recordCandidateLifecycleNotification(store, {
      candidateId: CANDIDATE,
      fromState: 'Needs Review',
      toState: 'Watch',
      analysisVerdict: 'strong_potential',
      locale: 'ko'
    });
    expect(store.rows).toHaveLength(1);
    expect(store.candidateState).toBe('Watch');
    expect(store.deliveries).toHaveLength(0);
  });
});
