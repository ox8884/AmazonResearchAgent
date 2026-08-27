import { createHash } from 'node:crypto';
import {
  routeAiRequest,
  type AiProvider,
  type AiProviderResult,
  type ProviderCatalog,
  type ProviderHealth,
  type StructuredAiRequest
} from '@ara/ai-router';
import {
  AiRequestSchema,
  NormalizeOpportunitiesJobPayloadSchema,
  ImportOpportunityCsvJobPayloadSchema
} from '@ara/shared';
import type { Job, JobType, QueueDatabaseClient } from '@ara/queue';
import {
  runImportJob,
  type ImportSourceFile
} from './jobs/import-opportunity-csv';
import { runNormalizeJob } from './jobs/normalize-opportunities';

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

class DeferredAiCapacityError extends Error {
  readonly retryable = true;

  constructor() {
    super('No eligible AI provider is currently available.');
    this.name = 'DeferredAiCapacityError';
  }
}

class DeferredAiProvider implements AiProvider {
  readonly id = 'deferred-ai-capacity';
  readonly billingType = 'subscription' as const;

  async health(): Promise<ProviderHealth> {
    return {
      available: false,
      checkedAt: new Date().toISOString(),
      reason: 'No eligible AI provider is currently available.',
      retryAfterSeconds: 60
    };
  }

  async listModels() {
    return [];
  }

  async runStructured<T>(
    request: StructuredAiRequest<T>
  ): Promise<AiProviderResult<T>> {
    void request;
    throw new DeferredAiCapacityError();
  }
}

const deferredAiProvider = new DeferredAiProvider();


export interface JobHandlerOptions {
  readonly normalizationProvider?: AiProvider;
  readonly normalizationCatalog?: ProviderCatalog;
}
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

export function createJobHandlers(
  client: QueueDatabaseClient,
  options: JobHandlerOptions = {}
): JobHandlers {
  const handlers: JobHandlers = {
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

  if (options.normalizationProvider || options.normalizationCatalog) {
    handlers.NORMALIZE_OPPORTUNITIES = async (job, context) => {
      const payload = NormalizeOpportunitiesJobPayloadSchema.parse(job.payload);
      let provider = options.normalizationProvider ?? deferredAiProvider;
      let modelId = payload.modelId ?? 'deferred-ai-model';

      if (options.normalizationCatalog) {
        const request = AiRequestSchema.parse({
          role: 'niche_normalization',
          routerMode: 'Balanced',
          locale: payload.locale,
          allowPaidFallback: false,
          payload: { candidateIds: payload.candidateIds }
        });
        const decision = routeAiRequest(request, options.normalizationCatalog);
        if (decision.kind === 'route') {
          provider = decision.provider;
          modelId = decision.model.id;
        } else {
          provider = deferredAiProvider;
        }
      }

      throwIfAborted(context.signal);
      const result = await runNormalizeJob(
        { candidateIds: payload.candidateIds, locale: payload.locale },
        {
          client,
          provider,
          modelId,
          promptVersion: payload.promptVersion,
          onCheckpoint: (value) => context.saveCheckpoint(value)
        }
      );
      return result.checkpoint;
    };
  }
  return handlers;
}
