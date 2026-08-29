import { describe, expect, it } from 'vitest';
import { budgetResumeIdempotencyKey } from './market-probe';

describe('Market Probe budget resume identity', () => {
  // Break: normal validation and strong revalidation share one resume key and can inherit the wrong budget policy.
  it('includes API purpose in deferred resume identity', () => {
    const candidateId = '00000000-0000-4000-8000-000000000001';
    const availableAt = '2099-01-02T00:00:00.000Z';
    const normal = budgetResumeIdempotencyKey(candidateId, 'normal_validation', availableAt);
    const strong = budgetResumeIdempotencyKey(candidateId, 'strong_revalidation', availableAt);

    expect(normal).toBe(
      `market-probe-resume:${candidateId}:normal_validation:2099-01-02`
    );
    expect(strong).toBe(
      `market-probe-resume:${candidateId}:strong_revalidation:2099-01-02`
    );
    expect(normal).not.toBe(strong);
  });
});
