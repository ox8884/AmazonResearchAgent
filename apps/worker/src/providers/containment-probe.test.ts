import { describe, expect, it } from 'vitest';
import {
  ContainmentProbeError,
  HOSTILE_CONTAINMENT_CATEGORIES,
  runContainmentProbe,
  type HostileContainmentCategory
} from './containment-probe';

describe('hostile containment probe', () => {
  // Break: a successful probe omits one of the required hostile categories.
  it('requires and digests every denial category in fixed order', async () => {
    const attempted: HostileContainmentCategory[] = [];
    const evidence = await runContainmentProbe({
      async attempt(category) {
        attempted.push(category);
        return true;
      }
    }, new AbortController().signal);
    expect(attempted).toEqual(HOSTILE_CONTAINMENT_CATEGORIES);
    expect(evidence.deniedCategories).toEqual(HOSTILE_CONTAINMENT_CATEGORIES);
    expect(evidence.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(evidence.deniedCategories)).toBe(true);
  });

  // Break: one permitted read/write/process/network/tool path still emits acceptance evidence.
  it('fails closed on the first unproven denial', async () => {
    await expect(runContainmentProbe({
      async attempt(category) {
        return category !== 'hermes_read';
      }
    }, new AbortController().signal)).rejects.toEqual(
      new ContainmentProbeError('hermes_read')
    );
  });

  // Break: cancellation is ignored between hostile operations.
  it('honors cancellation before further attempts', async () => {
    const controller = new AbortController();
    let attempts = 0;
    await expect(runContainmentProbe({
      async attempt() {
        attempts += 1;
        controller.abort(new DOMException('cancelled', 'AbortError'));
        return true;
      }
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
  });
});
