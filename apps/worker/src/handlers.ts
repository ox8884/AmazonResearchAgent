import type { Job, JobType } from '@ara/queue';

export interface JobExecutionContext {
  signal: AbortSignal;
  checkpoint: unknown;
  setCheckpoint(checkpoint: unknown): void;
}

export type JobHandler = (
  job: Job,
  context: JobExecutionContext
) => Promise<unknown>;

export type JobHandlers = Partial<Record<JobType, JobHandler>>;

export class UnsupportedJobTypeError extends Error {
  constructor(type: string) {
    super(`No worker handler is registered for job type: ${type}`);
    this.name = 'UnsupportedJobTypeError';
  }
}

export function resolveJobHandler(
  handlers: JobHandlers,
  type: JobType
): JobHandler {
  const handler = handlers[type];
  if (!handler) {
    throw new UnsupportedJobTypeError(type);
  }
  return handler;
}

export const handlers: JobHandlers = {};
