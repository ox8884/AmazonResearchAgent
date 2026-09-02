import { describe, expect, it, vi } from 'vitest';
import {
  DuplicateJobError,
  DurableQueue,
  parseProbeAiProviderReadinessPayload,
  providerReadinessProbeKey,
  type Job,
  type JobInsert,
  type JobLeaseIdentity,
  type QueueRepository
} from './queue';

class InMemoryQueueRepository implements QueueRepository {
  readonly jobs = new Map<string, Job>();
  insertAttempts = 0;

  async insertJob(input: JobInsert): Promise<string> {
    this.insertAttempts += 1;
    const existing = this.jobs.get(input.idempotencyKey);
    if (existing) {
      throw new DuplicateJobError(input.idempotencyKey);
    }

    const id = `job-${this.jobs.size + 1}`;
    this.jobs.set(input.idempotencyKey, {
      id,
      type: input.type,
      payload: input.payload,
      status: 'queued',
      priority: input.priority,
      availableAt: input.availableAt,
      leasedUntil: null,
      leasedBy: null,
      leaseIdentity: { jobId: id, owner: '', epoch: 0 },
      attempts: 0,
      maxAttempts: 5,
      idempotencyKey: input.idempotencyKey,
      checkpoint: {},
      lastError: null,
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z'
    });
    return id;
  }

  async findJobIdByIdempotencyKey(key: string): Promise<string | null> {
    return this.jobs.get(key)?.id ?? null;
  }

  async claimJobs(): Promise<Job[]> {
    return [];
  }

  async claimJobsByType(): Promise<Job[]> {
    return [];
  }

  async completeJob(): Promise<boolean> {
    return true;
  }

  async failJob(): Promise<boolean> {
    return true;
  }

  async heartbeatJob(): Promise<boolean> {
    return true;
  }

  async checkpointJob(): Promise<boolean> {
    return true;
  }
}

describe('durable queue', () => {
  // Break: replaying an idempotency key creates a second job or returns a new id.
  it('returns the existing job when idempotency_key is reused', async () => {
    const repository = new InMemoryQueueRepository();
    const queue = new DurableQueue(repository);

    const first = await queue.enqueueJob({
      type: 'IMPORT_OPPORTUNITY_CSV',
      payload: {},
      idempotencyKey: 'same'
    });
    const second = await queue.enqueueJob({
      type: 'IMPORT_OPPORTUNITY_CSV',
      payload: {},
      idempotencyKey: 'same'
    });

    expect(second).toBe(first);
    expect(repository.jobs.size).toBe(1);
  });
});

describe('job lease epochs', () => {
  // Break: a reclaimed job can be mutated by an old process that reused the same worker ID.
  it('passes the claimed epoch to every ownership-sensitive mutation', async () => {
    const repository = new InMemoryQueueRepository();
    const queue = new DurableQueue(repository);
    const lease: JobLeaseIdentity = { jobId: 'job-1', owner: 'worker-a', epoch: 7 };
    const complete = vi.spyOn(repository, 'completeJob');
    const fail = vi.spyOn(repository, 'failJob');
    const heartbeat = vi.spyOn(repository, 'heartbeatJob');
    const checkpoint = vi.spyOn(repository, 'checkpointJob');

    await queue.completeJob(lease, { phase: 'done' });
    await queue.failJob(lease, 'failed', '2026-08-30T00:00:00.000Z', { phase: 'failed' });
    await queue.heartbeatJob(lease, 120);
    await queue.checkpointJob(lease, { phase: 'saved' }, 120);

    expect(complete).toHaveBeenCalledWith(lease, { phase: 'done' });
    expect(fail).toHaveBeenCalledWith(
      lease,
      'failed',
      '2026-08-30T00:00:00.000Z',
      { phase: 'failed' }
    );
    expect(heartbeat).toHaveBeenCalledWith(lease, 120);
    expect(checkpoint).toHaveBeenCalledWith(lease, { phase: 'saved' }, 120);
  });
});

describe('provider readiness probe identity', () => {
  // Break: unchanged bindings collapse a later probe generation onto a completed job.
  it('includes generation in the strict database-compatible key', () => {
    const first = parseProbeAiProviderReadinessPayload({
      providerId: 'provider-a',
      settingsRevision: 4,
      authGeneration: 2,
      executionFingerprint: 'fingerprint-a',
      probeGeneration: 8
    });
    const second = { ...first, probeGeneration: 9 };
    expect(providerReadinessProbeKey(first)).toBe(
      'provider-probe:provider-a:4:2:fingerprint-a:8'
    );
    expect(providerReadinessProbeKey(second)).not.toBe(providerReadinessProbeKey(first));
  });

  // Break: malformed or caller-extended payloads bypass handler binding checks.
  it.each([
    { providerId: '', settingsRevision: 1, authGeneration: 0, executionFingerprint: 'fp', probeGeneration: 1 },
    { providerId: 'p', settingsRevision: -1, authGeneration: 0, executionFingerprint: 'fp', probeGeneration: 1 },
    { providerId: 'p', settingsRevision: 1, authGeneration: 0, executionFingerprint: 'fp', probeGeneration: 1, extra: true }
  ])('rejects malformed payload %#', (payload) => {
    expect(() => parseProbeAiProviderReadinessPayload(payload)).toThrow();
  });
});
