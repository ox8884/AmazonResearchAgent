import { describe, expect, it } from 'vitest';
import {
  AbuseGuardError,
  createConcurrencyGate,
  createTokenBucket
} from './abuse-guard';

describe('abuse guard', () => {
  it('rejects after the window budget is consumed', () => {
    const bucket = createTokenBucket({ max: 2, windowMs: 1_000 });
    bucket.consume('k', 1_000);
    bucket.consume('k', 1_100);
    expect(() => bucket.consume('k', 1_200)).toThrow(AbuseGuardError);
  });

  it('caps concurrent work before starting another unit', async () => {
    const gate = createConcurrencyGate(1);
    let startedSecond = false;
    const first = gate.run('login', async () => {
      await Promise.resolve();
      return 'ok';
    });
    await expect(
      gate.run('login', async () => {
        startedSecond = true;
        return 'nope';
      })
    ).rejects.toBeInstanceOf(AbuseGuardError);
    expect(startedSecond).toBe(false);
    await expect(first).resolves.toBe('ok');
  });
});
