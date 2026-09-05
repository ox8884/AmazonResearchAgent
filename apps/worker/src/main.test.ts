import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '@ara/queue';
import {
  assertSubscriptionWorkerTopology,
  createWorkerComposition,
  redactSecrets,
  retryDelayMilliseconds,
  runJob,
  runWorkerLoop,
  startWorker,
  type WorkerLogger,
  type WorkerQueue
} from './main';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    type: 'IMPORT_OPPORTUNITY_CSV',
    payload: {},
    status: 'running',
    priority: 100,
    availableAt: '2026-08-27T00:00:00.000Z',
    leasedUntil: '2026-08-27T00:02:00.000Z',
    leasedBy: 'worker-a',
    leaseIdentity: { jobId: 'job-1', owner: 'worker-a', epoch: 1 },
    attempts: 1,
    maxAttempts: 5,
    idempotencyKey: 'fixture',
    checkpoint: {},
    lastError: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides
  };
}

class FakeWorkerQueue implements WorkerQueue {
  completed: unknown[][] = [];
  failed: unknown[][] = [];
  heartbeats: unknown[][] = [];
  checkpoints: unknown[][] = [];
  terminalizedCount = 0;

  async terminalizeExpiredExhaustedJobs(): Promise<number> {
    return this.terminalizedCount;
  }

  async claimJobs(): Promise<Job[]> {
    return [];
  }

  async completeJob(...args: [Job['leaseIdentity'], unknown]): Promise<void> {
    this.completed.push(args);
  }

  async failJob(
    ...args: [Job['leaseIdentity'], string, string, unknown]
  ): Promise<void> {
    this.failed.push(args);
  }

  async heartbeatJob(...args: [Job['leaseIdentity'], number]): Promise<void> {
    this.heartbeats.push(args);
  }

  async checkpointJob(
    ...args: [Job['leaseIdentity'], unknown, number]
  ): Promise<void> {
    this.checkpoints.push(args);
  }
}

const silentLogger: WorkerLogger = {
  info() {},
  error() {}
};

afterEach(() => {
  vi.useRealTimers();
});

describe('worker job execution', () => {
  // Break: retry scheduling does not follow the approved 1m/5m/30m/2h sequence.
  it('uses the exponential retry schedule', () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMilliseconds)).toEqual([
      60_000,
      300_000,
      1_800_000,
      7_200_000,
      0
    ]);
  });

  // Break: a successful handler loses its final checkpoint or is marked failed.
  it('completes a successful job with its latest checkpoint', async () => {
    const queue = new FakeWorkerQueue();
    const controller = new AbortController();

    await runJob(makeJob(), {
      queue,
      handlers: {
        IMPORT_OPPORTUNITY_CSV: async (_job, context) => {
          await context.saveCheckpoint({ phase: 'parsed' });
          return { phase: 'completed' };
        }
      },
      workerId: 'worker-a',
      signal: controller.signal,
      logger: silentLogger
    });

    expect(queue.checkpoints).toEqual([
      [{ jobId: 'job-1', owner: 'worker-a', epoch: 1 }, { phase: 'parsed' }, 120]
    ]);
    expect(queue.completed).toEqual([
      [{ jobId: 'job-1', owner: 'worker-a', epoch: 1 }, { phase: 'completed' }]
    ]);
    expect(queue.failed).toEqual([]);
  });

  // Break: a handler failure stores secrets or uses the wrong retry delay/checkpoint.
  it('redacts errors and schedules a failed second attempt five minutes later', async () => {
    const queue = new FakeWorkerQueue();
    const controller = new AbortController();
    await runJob(makeJob({
      attempts: 2,
      leaseIdentity: { jobId: 'job-1', owner: 'worker-a', epoch: 2 }
    }), {
      queue,
      handlers: {
        IMPORT_OPPORTUNITY_CSV: async (_job, context) => {
          context.setCheckpoint({ phase: 'persisted_raw' });
          throw new Error('request used sb_secret_do-not-log');
        }
      },
      workerId: 'worker-a',
      signal: controller.signal,
      now: () => new Date('2026-08-27T00:00:00.000Z'),
      logger: silentLogger
    });

    expect(queue.failed).toEqual([
      [
        { jobId: 'job-1', owner: 'worker-a', epoch: 2 },
        'request used [REDACTED]',
        '2026-08-27T00:05:00.000Z',
        { phase: 'persisted_raw' }
      ]
    ]);
    expect(queue.completed).toEqual([]);
  });

  // Break: long-running handlers do not renew their database lease every 30 seconds.
  it('heartbeats while a handler remains in progress', async () => {
    vi.useFakeTimers();
    const queue = new FakeWorkerQueue();
    const controller = new AbortController();
    let finish: (() => void) | undefined;

    const running = runJob(makeJob(), {
      queue,
      handlers: {
        IMPORT_OPPORTUNITY_CSV: async () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      },
      workerId: 'worker-a',
      signal: controller.signal,
      heartbeatIntervalMs: 30_000,
      logger: silentLogger
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(queue.heartbeats).toEqual([
      [{ jobId: 'job-1', owner: 'worker-a', epoch: 1 }, 120]
    ]);
    if (!finish) {
      throw new Error('Expected the fixture handler to be waiting');
    }
    finish();
    await running;
  });

  // Break: an idle worker busy-loops or ignores cancellation instead of waiting two seconds.
  it('polls four jobs and waits when the queue is empty', async () => {
    const queue = new FakeWorkerQueue();
    const claim = vi.spyOn(queue, 'claimJobs');
    const controller = new AbortController();
    const sleeper = vi.fn(async (milliseconds: number) => {
      expect(milliseconds).toBe(2_000);
      controller.abort();
    });

    await runWorkerLoop({
      queue,
      handlers: {},
      workerId: 'worker-a',
      signal: controller.signal,
      sleep: sleeper,
      logger: silentLogger
    });

    expect(claim).toHaveBeenCalledWith('worker-a', 4, 120);
    expect(sleeper).toHaveBeenCalledOnce();
  });

  it('terminalizes exhausted expired jobs before polling for more work', async () => {
    const queue = new FakeWorkerQueue();
    queue.terminalizedCount = 1;
    const terminalize = vi.spyOn(queue, 'terminalizeExpiredExhaustedJobs');
    const claim = vi.spyOn(queue, 'claimJobs');
    const controller = new AbortController();
    const errors: string[] = [];

    await runWorkerLoop({
      queue,
      handlers: {},
      workerId: 'worker-a',
      signal: controller.signal,
      sleep: async () => controller.abort(),
      logger: {
        info() {},
        error(message) {
          errors.push(message);
        }
      }
    });

    expect(terminalize).toHaveBeenCalledBefore(claim);
    expect(errors).toEqual(['Terminalized 1 exhausted expired queue job.']);
  });

  // Break: known token formats pass through the worker logger unchanged.
  it('redacts supported secret formats', () => {
    expect(redactSecrets('Bearer abc sk-secret sb_secret_value')).toBe(
      'Bearer [REDACTED] [REDACTED] [REDACTED]'
    );
  });

  // Break: subscription execution starts with multiple worker processes and only local permits.
  it('rejects multi-process subscription topology without distributed coordination', () => {
    expect(() => assertSubscriptionWorkerTopology({
      workerProcessCount: 2,
      distributedCoordination: false
    })).toThrow(/one worker process/u);
    expect(() => assertSubscriptionWorkerTopology({
      workerProcessCount: 2,
      distributedCoordination: true
    })).not.toThrow();
  });

  // Break: each handler construction receives a different adapter registry.
  it('constructs one adapter semaphore registry for the worker composition', () => {
    const composition = createWorkerComposition();
    expect(composition.adapterSemaphores).toBe(
      composition.handlerOptions.adapterSemaphores
    );
  });
});

describe('worker startup identity gate', () => {
  const phaseBReleaseSha = '13b51161a28f3fbef7a193f13c4fe8bb35c0f21f';

  function startupFixture(data: unknown, claimedReleaseSha: string | undefined) {
    const createRuntime = vi.fn(() => ({
      queue: new FakeWorkerQueue(),
      handlers: {} as never
    }));
    const runLoop = vi.fn(async () => undefined);
    return {
      options: {
        client: { rpc: vi.fn(async () => ({ data, error: null })) } as never,
        claimedReleaseSha,
        createRuntime,
        runLoop,
        workerId: 'worker-a',
        signal: new AbortController().signal
      },
      createRuntime,
      runLoop
    };
  }

  // Break: missing, mutable, or wrong-migration identity reaches queue construction or claims.
  it.each([
    ['missing release', { mode: 'canonical', migration_identity: '202608290022' }, undefined],
    ['malformed release', { mode: 'canonical', migration_identity: '202608290022' }, 'not-a-sha'],
    ['wrong valid release', { mode: 'canonical', migration_identity: '202608290022' }, 'b'.repeat(40)],
    ['wrong migration', { mode: 'canonical', migration_identity: '202608290021' }, phaseBReleaseSha],
    ['legacy mode', { mode: 'legacy', migration_identity: '202608290022' }, phaseBReleaseSha]
  ] as const)('rejects %s before constructing claim-capable runtime', async (
    _label,
    capability,
    claimedReleaseSha
  ) => {
    const fixture = startupFixture(capability, claimedReleaseSha);
    await expect(startWorker(fixture.options)).rejects.toThrow(/writer capability|release SHA/u);
    expect(fixture.createRuntime).not.toHaveBeenCalled();
    expect(fixture.runLoop).not.toHaveBeenCalled();
  });

  // Break: the exact immutable identity cannot enter the worker loop after capability validation.
  it('enters the worker loop only after exact Phase-B identity validation', async () => {
    const fixture = startupFixture({
      mode: 'canonical',
      migration_identity: '202608290022'
    }, phaseBReleaseSha);
    await expect(startWorker(fixture.options)).resolves.toBeUndefined();
    expect(fixture.createRuntime).toHaveBeenCalledOnce();
    expect(fixture.runLoop).toHaveBeenCalledOnce();
  });
});
