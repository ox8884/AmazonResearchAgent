import { describe, expect, it } from 'vitest';
import {
  DuplicateJobError,
  DurableQueue,
  type Job,
  type JobInsert,
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
