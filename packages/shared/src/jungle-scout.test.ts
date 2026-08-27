import { describe, expect, it } from 'vitest';
import { makeApiCacheKey } from './jungle-scout';

describe('Jungle Scout cache identity', () => {
  // Break: phrase order or whitespace creates a different Product Database cache key.
  it('normalizes a Product Database request into a stable cache key', () => {
    expect(
      makeApiCacheKey({
        endpoint: 'product_database',
        marketplace: 'us',
        phrases: ['faucet mat', 'sink splash guard']
      })
    ).toBe(
      makeApiCacheKey({
        endpoint: 'product_database',
        marketplace: 'us',
        phrases: ['sink splash guard', 'faucet mat']
      })
    );
  });

  // Break: blank/duplicate phrases or mixed case change the cache identity.
  it('collapses duplicate and blank phrases case-insensitively', () => {
    expect(
      makeApiCacheKey({
        endpoint: 'product_database',
        marketplace: 'us',
        phrases: [' Faucet Mat ', '', 'faucet mat', 'sink splash guard']
      })
    ).toBe(
      makeApiCacheKey({
        endpoint: 'product_database',
        marketplace: 'us',
        phrases: ['sink splash guard', 'faucet mat']
      })
    );
  });
});
