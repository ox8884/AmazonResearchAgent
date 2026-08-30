import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  createProviderRuntimeRepository,
  createServerDatabaseClient
} from '@ara/db';
import { formatLog } from '@ara/shared';
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
import {
  ProviderCatalogCache,
  resolvePersistedProviderCatalog
} from './providers/provider-catalog';
import { AdapterSemaphoreRegistry } from './providers/adapter-semaphore';
import type { JobHandlerOptions } from './handlers';
import { ProviderSetupRequiredError } from './jobs/probe-ai-provider-readiness';
const WORKER_PROCESS_COUNT = 1;
const DISTRIBUTED_ADAPTER_COORDINATION = false;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000] as const;

export interface WorkerQueue {
  claimJobs(workerId: string, limit: number, leaseSeconds: number): Promise<Job[]>;
  completeJob(lease: Job['leaseIdentity'], checkpoint: unknown): Promise<void>;
  failJob(
    lease: Job['leaseIdentity'],
    errorText: string,
    retryAt: string,
    checkpoint: unknown
  ): Promise<void>;
  heartbeatJob(lease: Job['leaseIdentity'], leaseSeconds: number): Promise<void>;
  checkpointJob(
    lease: Job['leaseIdentity'],
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
    console.info(formatLog({ level: 'info', service: 'worker', event: message }));
  },
  error(message) {
    console.error(formatLog({ level: 'error', service: 'worker', event: message }));
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
      .heartbeatJob(job.leaseIdentity, leaseSeconds)
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
          job.leaseIdentity,
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

    await options.queue.completeJob(job.leaseIdentity, checkpoint);
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
      job.leaseIdentity,
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

export interface SubscriptionWorkerTopology {
  readonly workerProcessCount: number;
  readonly distributedCoordination: boolean;
}

export function assertSubscriptionWorkerTopology(
  topology: SubscriptionWorkerTopology
): void {
  if (
    !Number.isInteger(topology.workerProcessCount) ||
    topology.workerProcessCount < 1
  ) {
    throw new RangeError('Worker process count must be a positive integer.');
  }
  if (
    topology.workerProcessCount > 1 &&
    !topology.distributedCoordination
  ) {
    throw new Error(
      'Subscription execution requires one worker process without distributed coordination.'
    );
  }
}

export interface WorkerComposition {
  readonly adapterSemaphores: AdapterSemaphoreRegistry;
  readonly handlerOptions: JobHandlerOptions;
}

export function createWorkerComposition(): WorkerComposition {
  assertSubscriptionWorkerTopology({
    workerProcessCount: WORKER_PROCESS_COUNT,
    distributedCoordination: DISTRIBUTED_ADAPTER_COORDINATION
  });
  const adapterSemaphores = new AdapterSemaphoreRegistry();
  return {
    adapterSemaphores,
    handlerOptions: { adapterSemaphores }
  };
}

export async function main(): Promise<void> {
  const client = createServerDatabaseClient({
    url: requiredEnvironment('SUPABASE_URL'),
    serviceRoleKey: requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
  });
  const providerRuntime = createProviderRuntimeRepository(client);
  const providerCatalog = new ProviderCatalogCache(() =>
    resolvePersistedProviderCatalog(client, { runtimeRepository: providerRuntime })
  );
  const composition = createWorkerComposition();
  const queue = createQueue(client);
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    await runWorkerLoop({
      queue,
      handlers: createJobHandlers(client, {
        ...composition.handlerOptions,
        providerRuntime,
        resolveProviderProbe: async () => {
          throw new ProviderSetupRequiredError();
        },
        resolveProviderCatalog: (forceRefresh) =>
          providerCatalog.resolve(forceRefresh)
      }),
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
