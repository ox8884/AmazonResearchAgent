import { describe, expect, it, vi } from 'vitest';
import {
  assertNormalizationWriterCapability,
  NORMALIZATION_WRITER_MODE,
  normalizationWriterIdentity
} from './normalization-writer-mode';

describe('normalization writer mode', () => {
  // Break: Phase B starts before migration 022 or accepts the retired legacy capability.
  it('accepts only the immutable canonical capability', async () => {
    const canonical = { rpc: vi.fn(async () => ({ data: 'canonical', error: null })) };
    await expect(assertNormalizationWriterCapability(canonical as never)).resolves.toBeUndefined();
    expect(NORMALIZATION_WRITER_MODE).toBe('canonical');

    for (const value of ['legacy', 'unknown', null]) {
      const client = { rpc: vi.fn(async () => ({ data: value, error: null })) };
      await expect(assertNormalizationWriterCapability(client as never)).rejects.toThrow(
        /writer capability/u
      );
    }
  });

  // Break: the identity command reports the retired Phase A mode or drops the release SHA.
  it('reports the immutable Phase B mode with its build release identity', () => {
    expect(normalizationWriterIdentity('b'.repeat(40))).toEqual({
      mode: 'canonical',
      releaseSha: 'b'.repeat(40)
    });
    expect(() => normalizationWriterIdentity('not-a-sha')).toThrow(/release SHA/u);
  });
});
