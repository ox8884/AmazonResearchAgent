import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServerDatabaseClient } from '@ara/db';
import {
  createQueue,
  JobLeaseLostError,
  type Job
} from '@ara/queue';
import {
  createJobHandlers,
  resolveJobHandler,
  type JobHandlers
} from './handlers';
import { resolvePersistedProviderCatalog } from './providers/provider-catalog';

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000] as const;

export interface WorkerQueue {
  claimJobs(workerId: string, limit: number, leaseSeconds: number): Promise<Job[]>;
  completeJob(jobId: string, workerId: string, checkpoint: unknown): Promise<void>;
  failJob(
    jobId: string,
    workerId: string,
    errorText: string,
    retryAt: string,
    checkpoint: unknown
  ): Promise<void>;
  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number): Promise<void>;
  checkpointJob(
    jobId: string,
    workerId: string,
    checkpoint: unknown,
    leaseSeconds: number
  ): Promise<void>;
}

export interface WorkerLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface RunJobOptions {
  queue: WorkerQueue;
  handlers: JobHandlers;
  workerId: string;
  signal: AbortSignal;
  leaseSeconds?: number;
  heartbeatIntervalMs?: number;
  now?: () => Date;
  logger?: WorkerLogger;
}

export interface WorkerLoopOptions extends RunJobOptions {
  claimLimit?: number;
  idleDelayMs?: number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const consoleLogger: WorkerLogger = {
  info(message) {
    console.info(message);
  },
  error(message) {
    console.error(message);
  }
};

export function retryDelayMilliseconds(attempt: number): number {
  if (attempt < 1) {
    throw new RangeError('attempt must be at least 1');
  }
  return RETRY_DELAYS_MS[attempt - 1] ?? 0;
}

export function redactSecrets(message: string): string {
  return message
    .replace(/\bsb_secret_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }
  return 'Unknown worker error';
}

export function sleep(
  milliseconds: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });

    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

export async function runJob(job: Job, options: RunJobOptions): Promise<void> {
  const leaseSeconds = options.leaseSeconds ?? 120;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? consoleLogger;
  const executionController = new AbortController();
  let checkpoint: unknown = job.checkpoint;
  let heartbeatFailure: unknown;

  const abortExecution = (): void => executionController.abort(options.signal.reason);
  if (options.signal.aborted) {
    abortExecution();
  } else {
    options.signal.addEventListener('abort', abortExecution, { once: true });
  }

  const heartbeatTimer = setInterval(() => {
    void options.queue
      .heartbeatJob(job.id, options.workerId, leaseSeconds)
      .catch((error: unknown) => {
        heartbeatFailure = error;
        executionController.abort(error);
      });
  }, heartbeatIntervalMs);

  try {
    const handler = resolveJobHandler(options.handlers, job.type);
    const result = await handler(job, {
      signal: executionController.signal,
      checkpoint,
      setCheckpoint(nextCheckpoint) {
        checkpoint = nextCheckpoint;
      },
      async saveCheckpoint(nextCheckpoint) {
        await options.queue.checkpointJob(
          job.id,
          options.workerId,
          nextCheckpoint,
          leaseSeconds
        );
        checkpoint = nextCheckpoint;
      }
    });
    if (result !== undefined) {
      checkpoint = result;
    }
    if (heartbeatFailure) {
      throw heartbeatFailure;
    }

    await options.queue.completeJob(job.id, options.workerId, checkpoint);
    logger.info(`Completed job ${job.id} (${job.type})`);
  } catch (error) {
    if (error instanceof JobLeaseLostError || heartbeatFailure) {
      logger.error(`Lease lost for job ${job.id} (${job.type})`);
      return;
    }

    const retryAt = new Date(
      now().getTime() + retryDelayMilliseconds(job.attempts)
    ).toISOString();
    const safeError = errorMessage(error);
    await options.queue.failJob(
      job.id,
      options.workerId,
      safeError,
      retryAt,
      checkpoint
    );
    logger.error(`Failed job ${job.id} (${job.type}): ${safeError}`);
  } finally {
    clearInterval(heartbeatTimer);
    options.signal.removeEventListener('abort', abortExecution);
  }
}

export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
  const claimLimit = options.claimLimit ?? 4;
  const leaseSeconds = options.leaseSeconds ?? 120;
  const idleDelayMs = options.idleDelayMs ?? 2_000;
  const sleeper = options.sleep ?? sleep;

  while (!options.signal.aborted) {
    const jobs = await options.queue.claimJobs(
      options.workerId,
      claimLimit,
      leaseSeconds
    );
    if (jobs.length === 0) {
      await sleeper(idleDelayMs, options.signal);
      continue;
    }

    await Promise.all(
      jobs.map((job) =>
        runJob(job, {
          queue: options.queue,
          handlers: options.handlers,
          workerId: options.workerId,
          signal: options.signal,
          leaseSeconds,
          heartbeatIntervalMs: options.heartbeatIntervalMs ?? 30_000,
          now: options.now ?? (() => new Date()),
          logger: options.logger ?? consoleLogger
        })
      )
    );
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export async function main(): Promise<void> {
  const client = createServerDatabaseClient({
    url: requiredEnvironment('SUPABASE_URL'),
    serviceRoleKey: requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
  });
  const normalizationCatalog = await resolvePersistedProviderCatalog(client);
  const queue = createQueue(client);
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    await runWorkerLoop({
      queue,
      handlers: createJobHandlers(client, { normalizationCatalog }),
      workerId: process.env.WORKER_ID ?? `${hostname()}-${process.pid}`,
      signal: controller.signal
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main().catch((error: unknown) => {
    console.error(`Worker stopped: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
