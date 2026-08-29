import { describe, expect, it } from 'vitest';
import {
  budgetResumeIdempotencyKey,
  inFlightResumeIdempotencyKey
} from './market-probe';

describe('Market Probe resume identity', () => {
  // Break: normal validation and strong revalidation share one in-flight resume key and can inherit the wrong budget policy.
  it('includes API purpose in both reclaim-window identities', () => {
    const candidateId = '00000000-0000-4000-8000-000000000001';
    const cacheKey = 'product-database-cache';
    const reclaimBucket = '2099-01-02T00:00:00';
    const normal = inFlightResumeIdempotencyKey({
      candidateId,
      purpose: 'normal_validation',
      cacheKey,
      reclaimBucket,
      reclaim: false
    });
    const strong = inFlightResumeIdempotencyKey({
      candidateId,
      purpose: 'strong_revalidation',
      cacheKey,
      reclaimBucket,
      reclaim: false
    });
    const normalReclaim = inFlightResumeIdempotencyKey({
      candidateId,
      purpose: 'normal_validation',
      cacheKey,
      reclaimBucket,
      reclaim: true
    });
    const strongReclaim = inFlightResumeIdempotencyKey({
      candidateId,
      purpose: 'strong_revalidation',
      cacheKey,
      reclaimBucket,
      reclaim: true
    });

    expect(normal).toBe(
      `market-probe-inflight:${candidateId}:normal_validation:${cacheKey}:${reclaimBucket}`
    );
    expect(strong).toBe(
      `market-probe-inflight:${candidateId}:strong_revalidation:${cacheKey}:${reclaimBucket}`
    );
    expect(normalReclaim).toBe(`${normal}:reclaim`);
    expect(strongReclaim).toBe(`${strong}:reclaim`);
    expect(normal).not.toBe(strong);
    expect(normalReclaim).not.toBe(strongReclaim);
  });

  // Break: normal validation and strong revalidation share one deferred resume key and can inherit the wrong budget policy.
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
