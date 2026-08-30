import { describe, expect, it, vi } from 'vitest';
import {
  assertNormalizationWriterCapability,
  NORMALIZATION_WRITER_MODE,
  normalizationWriterIdentity
} from './normalization-writer-mode';

describe('normalization writer mode', () => {
  // Break: Phase A starts after migration 022 flipped the database to canonical mode.
  it('accepts only the immutable legacy capability', async () => {
    const legacy = { rpc: vi.fn(async () => ({ data: 'legacy', error: null })) };
    await expect(assertNormalizationWriterCapability(legacy as never)).resolves.toBeUndefined();
    expect(NORMALIZATION_WRITER_MODE).toBe('legacy');

    for (const value of ['canonical', 'unknown', null]) {
      const client = { rpc: vi.fn(async () => ({ data: value, error: null })) };
      await expect(assertNormalizationWriterCapability(client as never)).rejects.toThrow(
        /writer capability/u
      );
    }
  });

  // Break: the identity command reports a mutable mode or drops the recorded release SHA.
  it('reports the immutable Phase A mode with its build release identity', () => {
    expect(normalizationWriterIdentity('a'.repeat(40))).toEqual({
      mode: 'legacy',
      releaseSha: 'a'.repeat(40)
    });
    expect(() => normalizationWriterIdentity('not-a-sha')).toThrow(/release SHA/u);
  });
});
