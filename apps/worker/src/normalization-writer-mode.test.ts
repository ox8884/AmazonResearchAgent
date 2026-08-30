import { describe, expect, it, vi } from 'vitest';
import {
  assertNormalizationWriterCapability,
  NORMALIZATION_WRITER_MODE,
  normalizationWriterIdentity
} from './normalization-writer-mode';

const PHASE_B_RELEASE_SHA = '13b51161a28f3fbef7a193f13c4fe8bb35c0f21f';
const PHASE_B_CAPABILITY = {
  mode: 'canonical',
  migration_identity: '202608290022'
};

describe('normalization writer mode', () => {
  // Break: Phase B accepts mode-only, wrong-migration, or operator-selected release identity.
  it('accepts only the exact Phase-B capability and baked release identity', async () => {
    const canonical = {
      rpc: vi.fn(async () => ({ data: PHASE_B_CAPABILITY, error: null }))
    };
    await expect(assertNormalizationWriterCapability(
      canonical as never,
      PHASE_B_RELEASE_SHA
    )).resolves.toBeUndefined();
    expect(NORMALIZATION_WRITER_MODE).toBe('canonical');

    const invalidCapabilities = [
      'canonical',
      { mode: 'legacy', migration_identity: '202608290022' },
      { mode: 'canonical', migration_identity: '202608290021' },
      { mode: 'canonical' },
      null
    ];
    for (const data of invalidCapabilities) {
      const client = { rpc: vi.fn(async () => ({ data, error: null })) };
      await expect(assertNormalizationWriterCapability(
        client as never,
        PHASE_B_RELEASE_SHA
      )).rejects.toThrow(/writer capability/u);
    }

    for (const releaseSha of [
      undefined,
      'not-a-sha',
      'b'.repeat(40)
    ]) {
      await expect(assertNormalizationWriterCapability(
        canonical as never,
        releaseSha
      )).rejects.toThrow(/release SHA/u);
    }
  });

  // Break: the identity command echoes any mutable, merely well-formed runtime SHA.
  it('reports only the exact immutable Task-11 Phase-B identity', () => {
    expect(normalizationWriterIdentity(PHASE_B_RELEASE_SHA)).toEqual({
      mode: 'canonical',
      releaseSha: PHASE_B_RELEASE_SHA
    });
    expect(normalizationWriterIdentity()).toEqual({
      mode: 'canonical',
      releaseSha: PHASE_B_RELEASE_SHA
    });
    expect(() => normalizationWriterIdentity('not-a-sha')).toThrow(/release SHA/u);
    expect(() => normalizationWriterIdentity('b'.repeat(40))).toThrow(/release SHA/u);
  });
});
