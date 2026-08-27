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
  MarketProbeJobPayloadSchema,
  NormalizeOpportunitiesJobPayloadSchema,
  ImportOpportunityCsvJobPayloadSchema,
  TestAiProviderConnectionJobPayloadSchema
} from '@ara/shared';
import type { Job, JobType, QueueDatabaseClient } from '@ara/queue';
import {
  runImportJob,
  type ImportSourceFile
} from './jobs/import-opportunity-csv';
import { runProviderConnectionTest } from './jobs/test-ai-provider';
import { runMarketProbe } from './jobs/market-probe';
import { runNormalizeJob } from './jobs/normalize-opportunities';
import { PostgresApiBudget } from './jobs/postgres-api-budget';
import {
  createJungleScoutProductDatabaseQuery,
  readApiBudgetLimits,
  readJungleScoutEnv
} from './jungle-scout-runtime';
import type { ApiBudget } from '@ara/api-budget';
import type { ProductDatabasePage } from '@ara/jungle-scout';

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
  readonly resolveProviderCatalog?: (forceRefresh: boolean) => Promise<ProviderCatalog>;
  readonly apiBudget?: ApiBudget;
  readonly queryProductDatabase?: (phrases: readonly string[]) => Promise<ProductDatabasePage>;
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

  if (
    options.normalizationProvider ||
    options.normalizationCatalog ||
    options.resolveProviderCatalog
  ) {
    handlers.NORMALIZE_OPPORTUNITIES = async (job, context) => {
      const payload = NormalizeOpportunitiesJobPayloadSchema.parse(job.payload);
      let provider = options.normalizationProvider ?? deferredAiProvider;
      let modelId = payload.modelId ?? 'deferred-ai-model';
      const catalog =
        (await options.resolveProviderCatalog?.(false)) ??
        options.normalizationCatalog;

      if (catalog) {
        const request = AiRequestSchema.parse({
          role: 'niche_normalization',
          routerMode: 'Balanced',
          locale: payload.locale,
          allowPaidFallback: false,
          payload: { candidateIds: payload.candidateIds }
        });
        const decision = routeAiRequest(request, catalog);
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
          workerId: `normalization:${job.id}`,
          promptVersion: payload.promptVersion,
          onCheckpoint: (value) => context.saveCheckpoint(value)
        }
      );
      return result.checkpoint;
    };
  }
  const resolveCatalog = options.resolveProviderCatalog;
  if (resolveCatalog) {
    handlers.TEST_AI_PROVIDER_CONNECTION = async (job, context) => {
      const payload = TestAiProviderConnectionJobPayloadSchema.parse(job.payload);
      const result = await runProviderConnectionTest(payload.providerId, client);
      await resolveCatalog(true);
      const checkpoint = { phase: 'completed', providerTest: result };
      context.setCheckpoint(checkpoint);
      return checkpoint;
    };
  }
  handlers.MARKET_PROBE = async (job, context) => {
    const payload = MarketProbeJobPayloadSchema.parse(job.payload);
    const queryProductDatabase =
      options.queryProductDatabase ?? createJungleScoutProductDatabaseQuery();
    if (!options.queryProductDatabase) {
      readJungleScoutEnv();
    }
    const apiBudget =
      options.apiBudget ?? new PostgresApiBudget(client, readApiBudgetLimits());
    const result = await runMarketProbe(
      { candidateId: payload.candidateId, locale: payload.locale },
      {
        client,
        budget: apiBudget,
        queryProductDatabase,
        onCheckpoint: (value) => context.saveCheckpoint(value)
      }
    );
    return result.checkpoint;
  };
  return handlers;
}
