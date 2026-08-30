import type { SubscriptionAdapter } from '@ara/shared';

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (reason?: unknown) => void;
  readonly signal: AbortSignal;
  detachAbort(): void;
  active: boolean;
}

interface SemaphoreState {
  held: boolean;
  readonly queue: Waiter[];
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

export class AdapterSemaphoreRegistry {
  private readonly states: Record<SubscriptionAdapter, SemaphoreState> = {
    codex: { held: false, queue: [] },
    grok: { held: false, queue: [] }
  };

  async withPermit<T>(
    adapter: SubscriptionAdapter,
    signal: AbortSignal,
    work: () => Promise<T>
  ): Promise<T> {
    await this.acquire(adapter, signal);
    try {
      throwIfAborted(signal);
      return await work();
    } finally {
      this.release(adapter);
    }
  }

  private acquire(
    adapter: SubscriptionAdapter,
    signal: AbortSignal
  ): Promise<void> {
    throwIfAborted(signal);
    const state = this.states[adapter];
    if (!state.held) {
      state.held = true;
      return Promise.resolve();
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const waiter: Waiter = {
      resolve,
      reject,
      signal,
      active: true,
      detachAbort: () => signal.removeEventListener('abort', abort)
    };
    const abort = (): void => {
      if (!waiter.active) return;
      waiter.active = false;
      const index = state.queue.indexOf(waiter);
      if (index >= 0) state.queue.splice(index, 1);
      waiter.detachAbort();
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
    state.queue.push(waiter);
    return promise;
  }

  private release(adapter: SubscriptionAdapter): void {
    const state = this.states[adapter];
    while (state.queue.length > 0) {
      const waiter = state.queue.shift();
      if (waiter?.active !== true) continue;
      waiter.detachAbort();
      waiter.active = false;
      if (waiter.signal.aborted) {
        waiter.reject(abortReason(waiter.signal));
        continue;
      }
      waiter.resolve();
      return;
    }
    state.held = false;
  }
}
