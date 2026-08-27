import { describe, expect, it } from 'vitest';
import {
  MemoryApiBudget,
  authorizeApiCall
} from './index';

describe('Jungle Scout API budget policy', () => {
  // Break: normal research consumes the reserve or exceeds the daily cap.
  it('preserves reserve and defers normal research', async () => {
    const store = new MemoryApiBudget({
      dailyLimit: 20,
      used: 15,
      reserve: 5
    });

    const decision = await authorizeApiCall(store, {
      purpose: 'normal_validation',
      estimatedCalls: 1,
      cacheKey: 'new',
      endpoint: 'product_database'
    });

    expect(decision.kind).toBe('deferred_budget');
  });

  // Break: manual research cannot use the reserved remaining calls.
  it('allows manual research to use reserved calls', async () => {
    const store = new MemoryApiBudget({
      dailyLimit: 20,
      used: 15,
      reserve: 5
    });

    const decision = await authorizeApiCall(store, {
      purpose: 'manual_research',
      estimatedCalls: 1,
      cacheKey: 'new',
      endpoint: 'product_database'
    });

    expect(decision.kind).toBe('allowed');
  });

  // Break: a fresh cache entry still spends a call.
  it('returns cache_hit without consuming budget', async () => {
    const store = new MemoryApiBudget({
      dailyLimit: 20,
      used: 0,
      reserve: 5
    });
    store.seedCache('fresh-key', { capturedAt: new Date(), ttlMs: 24 * 60 * 60 * 1000 });

    const decision = await authorizeApiCall(store, {
      purpose: 'normal_validation',
      estimatedCalls: 1,
      cacheKey: 'fresh-key',
      endpoint: 'product_database'
    });

    expect(decision.kind).toBe('cache_hit');
    expect(store.used).toBe(0);
  });

  // Break: concurrent last-call reservations all succeed.
  it('allows only one of ten concurrent requests for the final call', async () => {
    const store = new MemoryApiBudget({
      dailyLimit: 6,
      used: 5,
      reserve: 0
    });

    const decisions = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        authorizeApiCall(store, {
          purpose: 'normal_validation',
          estimatedCalls: 1,
          cacheKey: `call-${index}`,
          endpoint: 'product_database'
        })
      )
    );

    expect(decisions.filter((decision) => decision.kind === 'allowed')).toHaveLength(1);
    expect(decisions.filter((decision) => decision.kind === 'deferred_budget')).toHaveLength(9);
    expect(store.used).toBe(6);
  });
});
