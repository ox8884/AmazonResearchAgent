import { createHash } from 'node:crypto';
import { ImportOpportunityCsvJobPayloadSchema } from '@ara/shared';
import type { Job, JobType, QueueDatabaseClient } from '@ara/queue';
import {
  runImportJob,
  type ImportSourceFile
} from './jobs/import-opportunity-csv';

export interface JobExecutionContext {
  signal: AbortSignal;
  checkpoint: unknown;
  setCheckpoint(checkpoint: unknown): void;
  saveCheckpoint(checkpoint: unknown): Promise<void>;
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

function contentSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Import job aborted', 'AbortError');
  }
}

async function downloadImportFiles(
  client: QueueDatabaseClient,
  storageBucket: string,
  files: ReturnType<typeof ImportOpportunityCsvJobPayloadSchema.parse>['files'],
  signal: AbortSignal
): Promise<ImportSourceFile[]> {
  const sources: ImportSourceFile[] = [];
  for (const file of files) {
    throwIfAborted(signal);
    const { data, error } = await client.storage
      .from(storageBucket)
      .download(file.storagePath);
    if (error || !data) {
      throw new Error(
        `Failed to download ${file.sourceFileName}: ${error?.message ?? 'empty Storage response'}`
      );
    }
    const content = await data.text();
    if (contentSha256(content) !== file.contentSha256) {
      throw new Error(`Content hash mismatch for ${file.sourceFileName}`);
    }
    sources.push({ sourceFileName: file.sourceFileName, content });
  }
  return sources;
}

export function createJobHandlers(client: QueueDatabaseClient): JobHandlers {
  return {
    IMPORT_OPPORTUNITY_CSV: async (job, context) => {
      const payload = ImportOpportunityCsvJobPayloadSchema.parse(job.payload);
      const files = await downloadImportFiles(
        client,
        payload.storageBucket,
        payload.files,
        context.signal
      );
      throwIfAborted(context.signal);
      const result = await runImportJob(
        { importRunId: payload.importRunId, files },
        {
          client,
          onCheckpoint: (value) => context.saveCheckpoint(value)
        }
      );
      return result.checkpoint;
    }
  };
}
