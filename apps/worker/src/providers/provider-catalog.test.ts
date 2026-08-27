import { describe, expect, it } from 'vitest';
import { ProviderCatalogCache } from './provider-catalog';
import type { ProviderCatalog } from '@ara/ai-router';

describe('provider catalog cache', () => {
  // Break: every job reloads providers, or a stale catalog is served after TTL/force refresh.
  it('reuses a catalog within TTL and reloads after expiry or force', async () => {
    let now = 1_000;
    let loads = 0;
    const empty: ProviderCatalog = { entries: [] };
    const cache = new ProviderCatalogCache(
      async () => {
        loads += 1;
        return empty;
      },
      60_000,
      () => now
    );

    await expect(cache.resolve()).resolves.toBe(empty);
    await expect(cache.resolve()).resolves.toBe(empty);
    expect(loads).toBe(1);

    now = 61_000;
    await cache.resolve();
    expect(loads).toBe(2);

    await cache.resolve(true);
    expect(loads).toBe(3);

    cache.invalidate();
    await cache.resolve();
    expect(loads).toBe(4);
  });
});
