import {
  createServerDatabaseClient,
  type Database,
  type Json
} from '@ara/db';

export type JobType = 'IMPORT_OPPORTUNITY_CSV' | 'NORMALIZE_OPPORTUNITIES';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type QueueDatabaseClient = ReturnType<typeof createServerDatabaseClient>;

type JobRow = Database['public']['Tables']['jobs']['Row'];

export interface Job {
  id: string;
  type: JobType;
  payload: Json;
  status: JobStatus;
  priority: number;
  availableAt: string;
  leasedUntil: string | null;
  leasedBy: string | null;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  checkpoint: Json;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueJobInput {
  type: JobType;
  payload: unknown;
  idempotencyKey: string;
  priority?: number;
  availableAt?: string;
}

export interface JobInsert {
  type: JobType;
  payload: Json;
  idempotencyKey: string;
  priority: number;
  availableAt: string;
}

export interface QueueRepository {
  insertJob(input: JobInsert): Promise<string>;
  findJobIdByIdempotencyKey(key: string): Promise<string | null>;
  claimJobs(workerId: string, limit: number, leaseSeconds: number): Promise<Job[]>;
  completeJob(
    jobId: string,
    workerId: string,
    checkpoint: Json
  ): Promise<boolean>;
  failJob(
    jobId: string,
    workerId: string,
    errorText: string,
    retryAt: string,
    checkpoint: Json
  ): Promise<boolean>;
  heartbeatJob(
    jobId: string,
    workerId: string,
    leaseSeconds: number
  ): Promise<boolean>;
  checkpointJob(
    jobId: string,
    workerId: string,
    checkpoint: Json,
    leaseSeconds: number
  ): Promise<boolean>;
}

export class DuplicateJobError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`A job already exists for idempotency key: ${idempotencyKey}`);
    this.name = 'DuplicateJobError';
  }
}

export class JobLeaseLostError extends Error {
  constructor(jobId: string, operation: string) {
    super(`Cannot ${operation} job ${jobId}: the worker does not own its lease`);
    this.name = 'JobLeaseLostError';
  }
}

export class QueueOperationError extends Error {
  constructor(operation: string, code: string | undefined, detail: string) {
    super(`${operation} failed${code ? ` (${code})` : ''}: ${detail}`);
    this.name = 'QueueOperationError';
  }
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type as JobType,
    payload: row.payload,
    status: row.status as JobStatus,
    priority: row.priority,
    availableAt: row.available_at,
    leasedUntil: row.leased_until,
    leasedBy: row.leased_by,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    idempotencyKey: row.idempotency_key,
    checkpoint: row.checkpoint,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function asJson(value: unknown): Json {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Queue payload and checkpoint must be JSON serializable');
  }

  try {
    return JSON.parse(serialized) as Json;
  } catch (error) {
    throw new TypeError('Queue payload and checkpoint must be JSON serializable', {
      cause: error
    });
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
}

export class SupabaseQueueRepository implements QueueRepository {
  constructor(private readonly client: QueueDatabaseClient) {}

  async insertJob(input: JobInsert): Promise<string> {
    const insert: Database['public']['Tables']['jobs']['Insert'] = {
      type: input.type,
      payload: input.payload,
      status: 'queued',
      priority: input.priority,
      available_at: input.availableAt,
      idempotency_key: input.idempotencyKey
    };
    const { data, error } = await this.client
      .from('jobs')
      .insert(insert)
      .select('id')
      .single();

    if (error?.code === '23505') {
      throw new DuplicateJobError(input.idempotencyKey);
    }
    if (error) {
      throw new QueueOperationError('enqueue job', error.code, error.message);
    }
    if (!data) {
      throw new QueueOperationError('enqueue job', undefined, 'no row returned');
    }
    return data.id;
  }

  async findJobIdByIdempotencyKey(key: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('jobs')
      .select('id')
      .eq('idempotency_key', key)
      .maybeSingle();

    if (error) {
      throw new QueueOperationError('find job', error.code, error.message);
    }
    return data?.id ?? null;
  }

  async claimJobs(
    workerId: string,
    limit: number,
    leaseSeconds: number
  ): Promise<Job[]> {
    const { data, error } = await this.client.rpc('claim_jobs', {
      worker_id: workerId,
      job_limit: limit,
      lease_seconds: leaseSeconds
    });

    if (error) {
      throw new QueueOperationError('claim jobs', error.code, error.message);
    }
    return (data ?? []).map(mapJob);
  }

  async completeJob(
    jobId: string,
    workerId: string,
    checkpoint: Json
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc('complete_job', {
      job_id: jobId,
      worker_id: workerId,
      checkpoint
    });
    if (error) {
      throw new QueueOperationError('complete job', error.code, error.message);
    }
    return data;
  }

  async failJob(
    jobId: string,
    workerId: string,
    errorText: string,
    retryAt: string,
    checkpoint: Json
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc('fail_job', {
      job_id: jobId,
      worker_id: workerId,
      error_text: errorText,
      retry_at: retryAt,
      checkpoint
    });
    if (error) {
      throw new QueueOperationError('fail job', error.code, error.message);
    }
    return data;
  }

  async heartbeatJob(
    jobId: string,
    workerId: string,
    leaseSeconds: number
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc('heartbeat_job', {
      job_id: jobId,
      worker_id: workerId,
      lease_seconds: leaseSeconds
    });
    if (error) {
      throw new QueueOperationError('heartbeat job', error.code, error.message);
    }
    return data;
  }

  async checkpointJob(
    jobId: string,
    workerId: string,
    checkpoint: Json,
    leaseSeconds: number
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc('checkpoint_job', {
      job_id: jobId,
      worker_id: workerId,
      checkpoint,
      lease_seconds: leaseSeconds
    });
    if (error) {
      throw new QueueOperationError('checkpoint job', error.code, error.message);
    }
    return data;
  }
}

export class DurableQueue {
  constructor(private readonly repository: QueueRepository) {}

  async enqueueJob(input: EnqueueJobInput): Promise<string> {
    assertNonEmpty(input.idempotencyKey, 'idempotencyKey');
    const priority = input.priority ?? 100;
    if (!Number.isInteger(priority)) {
      throw new TypeError('priority must be an integer');
    }
    const availableAt = input.availableAt ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(availableAt))) {
      throw new TypeError('availableAt must be an ISO date-time string');
    }

    const insert: JobInsert = {
      type: input.type,
      payload: asJson(input.payload),
      idempotencyKey: input.idempotencyKey,
      priority,
      availableAt
    };

    try {
      return await this.repository.insertJob(insert);
    } catch (error) {
      if (!(error instanceof DuplicateJobError)) {
        throw error;
      }
      const existing = await this.repository.findJobIdByIdempotencyKey(
        input.idempotencyKey
      );
      if (!existing) {
        throw new QueueOperationError(
          'resolve duplicate job',
          undefined,
          'the conflicting row was not visible'
        );
      }
      return existing;
    }
  }

  claimJobs(workerId: string, limit: number, leaseSeconds: number): Promise<Job[]> {
    assertNonEmpty(workerId, 'workerId');
    return this.repository.claimJobs(workerId, limit, leaseSeconds);
  }

  async completeJob(
    jobId: string,
    workerId: string,
    checkpoint: unknown
  ): Promise<void> {
    const completed = await this.repository.completeJob(
      jobId,
      workerId,
      asJson(checkpoint)
    );
    if (!completed) {
      throw new JobLeaseLostError(jobId, 'complete');
    }
  }

  async failJob(
    jobId: string,
    workerId: string,
    errorText: string,
    retryAt: string,
    checkpoint: unknown
  ): Promise<void> {
    const failed = await this.repository.failJob(
      jobId,
      workerId,
      errorText,
      retryAt,
      asJson(checkpoint)
    );
    if (!failed) {
      throw new JobLeaseLostError(jobId, 'fail');
    }
  }

  async heartbeatJob(
    jobId: string,
    workerId: string,
    leaseSeconds: number
  ): Promise<void> {
    const heartbeated = await this.repository.heartbeatJob(
      jobId,
      workerId,
      leaseSeconds
    );
    if (!heartbeated) {
      throw new JobLeaseLostError(jobId, 'heartbeat');
    }
  }

  async checkpointJob(
    jobId: string,
    workerId: string,
    checkpoint: unknown,
    leaseSeconds: number
  ): Promise<void> {
    const checkpointed = await this.repository.checkpointJob(
      jobId,
      workerId,
      asJson(checkpoint),
      leaseSeconds
    );
    if (!checkpointed) {
      throw new JobLeaseLostError(jobId, 'checkpoint');
    }
  }
}

export function createQueue(client: QueueDatabaseClient): DurableQueue {
  return new DurableQueue(new SupabaseQueueRepository(client));
}

let configuredQueue: DurableQueue | undefined;

export function configureQueue(client: QueueDatabaseClient): DurableQueue {
  configuredQueue = createQueue(client);
  return configuredQueue;
}

function getConfiguredQueue(): DurableQueue {
  if (!configuredQueue) {
    throw new Error('Queue has not been configured with a server database client');
  }
  return configuredQueue;
}

export function enqueueJob(input: EnqueueJobInput): Promise<string> {
  return getConfiguredQueue().enqueueJob(input);
}

export function claimJobs(
  workerId: string,
  limit: number,
  leaseSeconds: number
): Promise<Job[]> {
  return getConfiguredQueue().claimJobs(workerId, limit, leaseSeconds);
}

export function completeJob(
  jobId: string,
  workerId: string,
  checkpoint: unknown
): Promise<void> {
  return getConfiguredQueue().completeJob(jobId, workerId, checkpoint);
}

export function failJob(
  jobId: string,
  workerId: string,
  errorText: string,
  retryAt: string,
  checkpoint: unknown
): Promise<void> {
  return getConfiguredQueue().failJob(
    jobId,
    workerId,
    errorText,
    retryAt,
    checkpoint
  );
}

export function heartbeatJob(
  jobId: string,
  workerId: string,
  leaseSeconds: number
): Promise<void> {
  return getConfiguredQueue().heartbeatJob(jobId, workerId, leaseSeconds);
}


export function checkpointJob(
  jobId: string,
  workerId: string,
  checkpoint: unknown,
  leaseSeconds: number
): Promise<void> {
  return getConfiguredQueue().checkpointJob(
    jobId,
    workerId,
    checkpoint,
    leaseSeconds
  );
}
