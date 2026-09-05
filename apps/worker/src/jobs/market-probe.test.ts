import { describe, expect, it } from 'vitest';
import {
  assessMarketEvidence,
  budgetResumeIdempotencyKey,
  inFlightResumeIdempotencyKey,
  resumedMarketProbeCacheKey
} from './market-probe';
import type { ProductFamily } from '@ara/research-engine';

const COMPLETE_FAMILY: ProductFamily = {
  parentKey: 'B0PARENT',
  observedMonthlyUnits: 120,
  observedMonthlyRevenue: 2400,
  qualityNotes: [],
  variants: [
    {
      id: 'B0CHILD',
      title: 'Observed product',
      parentAsin: 'B0PARENT',
      unitsSold30: 120,
      revenue30: 2400,
      price: 20,
      reviews: null,
      rating: null,
      brand: null,
      weight: null,
      updatedAt: null,
      sellerType: null
    }
  ]
};

describe('Market Probe resume identity', () => {
  it('resumes an expanded probe from the cache key that produced the checkpoint', () => {
    const primaryCacheKey = 'product-database:primary';
    const expandedCacheKey = 'product-database:expanded';

    expect(
      resumedMarketProbeCacheKey(primaryCacheKey, {
        phase: 'api_fetched',
        cacheKey: expandedCacheKey
      })
    ).toBe(expandedCacheKey);
  });

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

  it('keeps provider update age unknown while accepting a fresh cache observation', () => {
    const evidence = assessMarketEvidence({
      families: [COMPLETE_FAMILY],
      cacheCapturedAt: '2099-01-01T11:00:00.000Z',
      now: new Date('2099-01-01T12:00:00.000Z')
    });

    expect(evidence.kind).toBe('ready');
    expect(evidence.providerUpdatedAt).toBeNull();
    expect(evidence.providerUpdatedAtAvailability).toBe('unavailable');
  });

  it('blocks a known stale provider row even when other provider update times are unavailable', () => {
    const original = COMPLETE_FAMILY.variants[0];
    if (!original) {
      throw new Error('Expected the complete family fixture to have one variant.');
    }
    const evidence = assessMarketEvidence({
      families: [
        {
          ...COMPLETE_FAMILY,
          variants: [
            {
              ...original,
              updatedAt: '2098-11-01T12:00:00.000Z'
            },
            {
              ...original,
              id: 'B0UNKNOWN',
              updatedAt: null
            }
          ]
        }
      ],
      cacheCapturedAt: '2099-01-01T11:00:00.000Z',
      now: new Date('2099-01-01T12:00:00.000Z')
    });

    expect(evidence.kind).toBe('stale_provider_source');
    expect(evidence.providerUpdatedAtAvailability).toBe('partial');
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
