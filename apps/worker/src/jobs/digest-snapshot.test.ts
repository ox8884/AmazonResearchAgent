import { describe, expect, it } from 'vitest';
import { researchRunIdFromNotifications } from './digest-snapshot';

const RUN = '80a100b2-70b3-4dea-911d-7b947e56a9f5';

describe('researchRunIdFromNotifications', () => {
  it('prefers an explicit run id', () => {
    expect(
      researchRunIdFromNotifications(
        [{ event_type: 'DAILY_SUMMARY', payload: {}, idempotency_key: 'daily-summary:other' }],
        RUN
      )
    ).toBe(RUN);
  });

  it('reads the daily-summary idempotency key', () => {
    expect(
      researchRunIdFromNotifications([
        { event_type: 'DAILY_SUMMARY', payload: { summary: `research run ${RUN}` }, idempotency_key: `daily-summary:${RUN}` }
      ])
    ).toBe(RUN);
  });
});
