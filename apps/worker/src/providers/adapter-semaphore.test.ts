import { describe, expect, it } from 'vitest';
import type { SubscriptionAdapter } from '@ara/shared';
import { AdapterSemaphoreRegistry } from './adapter-semaphore';

function deferred<T>() {
  return Promise.withResolvers<T>();
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('AdapterSemaphoreRegistry', () => {
  // Break: two calls can mutate the same Codex auth home concurrently.
  it('serializes two Codex calls in FIFO order', async () => {
    const registry = new AdapterSemaphoreRegistry();
    const firstRelease = deferred<void>();
    const events: string[] = [];
    const signal = new AbortController().signal;

    const first = registry.withPermit('codex', signal, async () => {
      events.push('first-start');
      await firstRelease.promise;
      events.push('first-end');
      return 1;
    });
    const second = registry.withPermit('codex', signal, async () => {
      events.push('second-start');
      return 2;
    });

    await flushMicrotasks();
    expect(events).toEqual(['first-start']);
    firstRelease.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });

  // Break: independent adapter auth homes share one global permit.
  it('allows Codex and Grok to each hold one permit', async () => {
    const registry = new AdapterSemaphoreRegistry();
    const release = deferred<void>();
    const entered: SubscriptionAdapter[] = [];
    const signal = new AbortController().signal;
    const run = (adapter: SubscriptionAdapter) =>
      registry.withPermit(adapter, signal, async () => {
        entered.push(adapter);
        await release.promise;
      });

    const calls = [run('codex'), run('grok')];
    await flushMicrotasks();
    expect(entered).toEqual(['codex', 'grok']);
    release.resolve();
    await Promise.all(calls);
  });

  // Break: an aborted queued waiter still reaches attempt-authorizing work.
  it('queued cancellation never runs work', async () => {
    const registry = new AdapterSemaphoreRegistry();
    const release = deferred<void>();
    const blocker = registry.withPermit(
      'codex',
      new AbortController().signal,
      () => release.promise
    );
    const queued = new AbortController();
    let attempts = 0;
    const cancelled = registry.withPermit('codex', queued.signal, async () => {
      attempts += 1;
    });

    await flushMicrotasks();
    queued.abort(new DOMException('cancelled', 'AbortError'));
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(0);
    release.resolve();
    await blocker;
  });

  for (const outcome of ['success', 'error', 'timeout', 'cancellation'] as const) {
    // Break: a terminal path leaks the permit and starves later work.
    it(`releases the permit after ${outcome}`, async () => {
      const registry = new AdapterSemaphoreRegistry();
      const firstSignal = new AbortController();
      const first = registry.withPermit('grok', firstSignal.signal, async () => {
        switch (outcome) {
          case 'success': return;
          case 'error': throw new Error('failure');
          case 'timeout': throw new DOMException('timed out', 'TimeoutError');
          case 'cancellation':
            firstSignal.abort();
            throw new DOMException('cancelled', 'AbortError');
        }
      });
      await first.catch(() => undefined);

      let ran = false;
      await registry.withPermit(
        'grok',
        new AbortController().signal,
        async () => { ran = true; }
      );
      expect(ran).toBe(true);
    });
  }
});
