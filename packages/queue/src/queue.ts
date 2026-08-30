import {
  createServerDatabaseClient,
  type Database,
  type Json
} from '@ara/db';

export type JobType =
  | 'IMPORT_OPPORTUNITY_CSV'
  | 'NORMALIZE_OPPORTUNITIES'
  | 'TEST_AI_PROVIDER_CONNECTION'
  | 'MARKET_PROBE'
  | 'DEEP_VALIDATION'
  | 'ENRICH_STRONG_POTENTIAL'
  | 'DAILY_RESEARCH'
  | 'SEND_DIGEST';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type QueueDatabaseClient = ReturnType<typeof createServerDatabaseClient>;

type JobRow = Database['public']['Tables']['jobs']['Row'];

export interface JobLeaseIdentity {
  readonly jobId: string;
  readonly owner: string;
  readonly epoch: number;
}
export interface Job {
  id: string;
  type: JobType;
  payload: Json;
  status: JobStatus;
  priority: number;
  availableAt: string;
  leasedUntil: string | null;
  leasedBy: string | null;
  leaseIdentity: JobLeaseIdentity;
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
  completeJob(lease: JobLeaseIdentity, checkpoint: Json): Promise<boolean>;
  failJob(
    lease: JobLeaseIdentity,
    errorText: string,
    retryAt: string,
    checkpoint: Json
  ): Promise<boolean>;
  heartbeatJob(lease: JobLeaseIdentity, leaseSeconds: number): Promise<boolean>;
  checkpointJob(
    lease: JobLeaseIdentity,
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
    leaseIdentity: { jobId: row.id, owner: row.leased_by ?? '', epoch: row.attempts },
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
    lease: JobLeaseIdentity,
    checkpoint: Json
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc('complete_job', {
      job_id: lease.jobId,
      worker_id: lease.owner,
      job_lease_epoch: lease.epoch,
      checkpoint
    });
    if (error) {
      throw new QueueOperationError('complete job', error.code, error.message);
    }
    return data;
  }

  async failJob(
    lease: JobLeaseIdentity,
    errorText: string,
    retryAt: string,
    checkpoint: Json
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc('fail_job', {
      job_id: lease.jobId,
      worker_id: lease.owner,
      job_lease_epoch: lease.epoch,
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
    lease: JobLeaseIdentity,
    leaseSeconds: number
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc('heartbeat_job', {
      job_id: lease.jobId,
      worker_id: lease.owner,
      job_lease_epoch: lease.epoch,
      lease_seconds: leaseSeconds
    });
    if (error) {
      throw new QueueOperationError('heartbeat job', error.code, error.message);
    }
    return data;
  }

  async checkpointJob(
    lease: JobLeaseIdentity,
    checkpoint: Json,
    leaseSeconds: number
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc('checkpoint_job', {
      job_id: lease.jobId,
      worker_id: lease.owner,
      job_lease_epoch: lease.epoch,
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

  async completeJob(lease: JobLeaseIdentity, checkpoint: unknown): Promise<void> {
    const completed = await this.repository.completeJob(lease, asJson(checkpoint));
    if (!completed) {
      throw new JobLeaseLostError(lease.jobId, 'complete');
    }
  }

  async failJob(
    lease: JobLeaseIdentity,
    errorText: string,
    retryAt: string,
    checkpoint: unknown
  ): Promise<void> {
    const failed = await this.repository.failJob(
      lease,
      errorText,
      retryAt,
      asJson(checkpoint)
    );
    if (!failed) {
      throw new JobLeaseLostError(lease.jobId, 'fail');
    }
  }

  async heartbeatJob(lease: JobLeaseIdentity, leaseSeconds: number): Promise<void> {
    const heartbeated = await this.repository.heartbeatJob(lease, leaseSeconds);
    if (!heartbeated) {
      throw new JobLeaseLostError(lease.jobId, 'heartbeat');
    }
  }

  async checkpointJob(
    lease: JobLeaseIdentity,
    checkpoint: unknown,
    leaseSeconds: number
  ): Promise<void> {
    const checkpointed = await this.repository.checkpointJob(
      lease,
      asJson(checkpoint),
      leaseSeconds
    );
    if (!checkpointed) {
      throw new JobLeaseLostError(lease.jobId, 'checkpoint');
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
  lease: JobLeaseIdentity,
  checkpoint: unknown
): Promise<void> {
  return getConfiguredQueue().completeJob(lease, checkpoint);
}

export function failJob(
  lease: JobLeaseIdentity,
  errorText: string,
  retryAt: string,
  checkpoint: unknown
): Promise<void> {
  return getConfiguredQueue().failJob(lease, errorText, retryAt, checkpoint);
}

export function heartbeatJob(
  lease: JobLeaseIdentity,
  leaseSeconds: number
): Promise<void> {
  return getConfiguredQueue().heartbeatJob(lease, leaseSeconds);
}

export function checkpointJob(
  lease: JobLeaseIdentity,
  checkpoint: unknown,
  leaseSeconds: number
): Promise<void> {
  return getConfiguredQueue().checkpointJob(lease, checkpoint, leaseSeconds);
}
