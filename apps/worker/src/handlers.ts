import { createHash } from 'node:crypto';
import {
  createNormalizationRearmRepository,
  type ProviderRuntimeRepository
} from '@ara/db';
import type { ProviderCatalog } from '@ara/ai-router';
import {
  DeepValidationJobPayloadSchema,
  EnrichStrongPotentialJobPayloadSchema,
  MarketProbeJobPayloadSchema,
  NormalizeOpportunitiesJobPayloadSchema,
  ImportOpportunityCsvJobPayloadSchema,
  LocaleSchema,
  TestAiProviderConnectionJobPayloadSchema
} from '@ara/shared';

import {
  createQueue,
  parseProbeAiProviderReadinessPayload,
  type Job,
  type JobType,
  type QueueDatabaseClient
} from '@ara/queue';
import {
  runImportJob,
  type ImportSourceFile
} from './jobs/import-opportunity-csv';
import { runProviderConnectionTest } from './jobs/test-ai-provider';
import {
  runProviderReadinessProbe,
  type ProviderProbeInspector,
  type ProviderProbeTarget
} from './jobs/probe-ai-provider-readiness';
import { runMarketProbe, type MarketProbeCheckpoint } from './jobs/market-probe';
import { runDeepValidation } from './jobs/deep-validation';
import { runEnrichStrongPotential } from './jobs/enrich-strong-potential';
import { runSendDigest } from './jobs/send-digest';
import { runNormalizeJob } from './jobs/normalize-opportunities';
import { runDailyResearch } from './jobs/daily-research';
import { PostgresApiBudget } from './jobs/postgres-api-budget';
import {
  assessResearchApiAdmission,
  isExplicitInitialCheck,
  loadResearchBusinessAdmissionContext,
  researchBusinessAdmissionIdempotencySuffix
} from './jobs/research-business-policy';
import {
  createJungleScoutHistoricalSearchVolumeQuery,
  createJungleScoutKeywordQuery,
  createJungleScoutProductDatabaseQuery,
  createJungleScoutSalesEstimatesQuery,
  createJungleScoutShareOfVoiceQuery,
  readApiBudgetLimits,
  readJungleScoutEnv
} from './jungle-scout-runtime';
import type { ApiBudget } from '@ara/api-budget';
import type { KeywordMetrics, ProductDatabaseQueryResult } from '@ara/jungle-scout';
import type { AdapterSemaphoreRegistry } from './providers/adapter-semaphore';
import type { NormalizationExecutionCoordinator } from './providers/normalization-execution-coordinator';





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

export interface ProviderProbeResolution {
  readonly target: ProviderProbeTarget;
  readonly currentProbeGeneration: number;
  readonly inspector: ProviderProbeInspector;
}

export interface JobHandlerOptions {
  readonly normalizationCatalog?: ProviderCatalog;
  readonly resolveProviderCatalog?: (forceRefresh: boolean) => Promise<ProviderCatalog>;
  readonly normalizationCoordinator?: NormalizationExecutionCoordinator;
  readonly adapterSemaphores?: AdapterSemaphoreRegistry;
  readonly providerRuntime?: ProviderRuntimeRepository;
  readonly resolveProviderProbe?: (
    providerId: string
  ) => Promise<ProviderProbeResolution>;
  readonly apiBudget?: ApiBudget;
  readonly queryProductDatabase?: (
    phrases: readonly string[]
  ) => Promise<ProductDatabaseQueryResult>;
  readonly queryKeyword?: (keyword: string) => Promise<KeywordMetrics>;

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

function contentSha256(content: string | ArrayBuffer): string {
  return createHash('sha256')
    .update(typeof content === 'string' ? content : new Uint8Array(content))
    .digest('hex');
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
    const bytes = await data.arrayBuffer();
    const content = new TextDecoder().decode(bytes);
    if (contentSha256(bytes) !== file.contentSha256) {
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
    options.normalizationCoordinator &&
    (options.normalizationCatalog || options.resolveProviderCatalog)
  ) {
    const coordinator = options.normalizationCoordinator;
    handlers.NORMALIZE_OPPORTUNITIES = async (job, context) => {
      const payload = NormalizeOpportunitiesJobPayloadSchema.parse(job.payload);
      const catalog =
        (await options.resolveProviderCatalog?.(false)) ??
        options.normalizationCatalog;
      if (!catalog) throw new Error('Normalization provider catalog is required.');
      throwIfAborted(context.signal);
      const result = await runNormalizeJob(
        {
          candidateIds: payload.candidateIds,
          locale: payload.locale,
          normalizationGeneration: payload.normalizationGeneration
        },
        {
          client,
          coordinator,
          catalog,
          jobLease: job.leaseIdentity,
          signal: context.signal,
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
  const providerRuntime = options.providerRuntime;
  const resolveProviderProbe = options.resolveProviderProbe;
  const probeSemaphores = options.adapterSemaphores;
  if (providerRuntime && resolveProviderProbe && probeSemaphores) {
    handlers.PROBE_AI_PROVIDER_READINESS = async (job, context) => {
      const payload = parseProbeAiProviderReadinessPayload(job.payload);
      const resolution = await resolveProviderProbe(payload.providerId);
      const result = await runProviderReadinessProbe({
        payload,
        onReady: async () => {
          const { data: settings, error } = await client
            .from('app_settings')
            .select('locale')
            .eq('id', true)
            .maybeSingle();
          if (error) throw new Error('Could not read normalization locale.', { cause: error });
          const locale = LocaleSchema.parse(settings?.locale ?? 'ko');
          await createNormalizationRearmRepository(client).rearmWaitingCandidates(locale);
        },
        ...resolution,
        runtime: providerRuntime,
        semaphores: probeSemaphores,
        signal: context.signal
      });
      const checkpoint = { phase: 'completed', providerProbe: result };
      context.setCheckpoint(checkpoint);
      return checkpoint;
    };
  }
  const queue = createQueue(client);
  const enqueueExplicitRequestedFollowups = async (
    candidateId: string,
    locale: 'ko' | 'en'
  ): Promise<void> => {
    const businessContext = await loadResearchBusinessAdmissionContext(client, candidateId);
    const suffix = researchBusinessAdmissionIdempotencySuffix(businessContext);
    if (suffix === null) {
      return;
    }
    const admits = (endpoint: 'keywords_by_keyword' | 'historical_search_volume' | 'sales_estimates' | 'share_of_voice') =>
      assessResearchApiAdmission({
        assessment: businessContext.assessment,
        evidence: businessContext.evidence,
        requestedEndpoint: endpoint,
        explicitInitialCheck: isExplicitInitialCheck(businessContext.evidence, endpoint)
      }).allowed;
    if (admits('keywords_by_keyword')) {
      await queue.enqueueJob({
        type: 'DEEP_VALIDATION',
        payload: { candidateId, locale },
        idempotencyKey: `deep-validation:${candidateId}:${suffix}`
      });
    }
    if (
      admits('historical_search_volume') ||
      admits('sales_estimates') ||
      admits('share_of_voice')
    ) {
      await queue.enqueueJob({
        type: 'ENRICH_STRONG_POTENTIAL',
        payload: { candidateId, locale },
        idempotencyKey: `enrich-strong:${candidateId}:${suffix}`
      });
    }
  };
  handlers.DAILY_RESEARCH = async (job, context) => {
    const result = await runDailyResearch(job, { client, queue });
    context.setCheckpoint(result);
    return result;
  };
  handlers.SEND_DIGEST = async () => runSendDigest(client);
  const budgetFor = (job: Job): ApiBudget =>
    options.apiBudget ??
    new PostgresApiBudget(client, readApiBudgetLimits(), `job:${job.id}:${job.attempts}`);
  handlers.MARKET_PROBE = async (job, context) => {
    const payload = MarketProbeJobPayloadSchema.parse(job.payload);
    const queryProductDatabase =
      options.queryProductDatabase ?? createJungleScoutProductDatabaseQuery();
    if (!options.queryProductDatabase) {
      readJungleScoutEnv();
    }
    const apiBudget = budgetFor(job);

    const prior =
      typeof context.checkpoint === 'object' &&
      context.checkpoint !== null &&
      'phase' in context.checkpoint &&
      typeof context.checkpoint.phase === 'string'
        ? (context.checkpoint as MarketProbeCheckpoint)
        : undefined;
    const result = await runMarketProbe(
      { candidateId: payload.candidateId, locale: payload.locale },
      {
        client,
        budget: apiBudget,
        purpose: payload.purpose ?? 'normal_validation',
        ...(payload.researchRunId ? { researchRunId: payload.researchRunId } : {}),
        queryProductDatabase,
        ...(prior ? { checkpoint: prior } : {}),
        enqueueResume: async (input) => {
          await queue.enqueueJob({
            type: 'MARKET_PROBE',
            payload: {
              candidateId: input.candidateId,
              locale: input.locale,
              ...(input.researchRunId ? { researchRunId: input.researchRunId } : {}),
              purpose: input.purpose
            },
            idempotencyKey: input.idempotencyKey,
            availableAt: input.availableAt
          });
        },
        onCheckpoint: (value) => context.saveCheckpoint(value)
      }
    );
    await enqueueExplicitRequestedFollowups(payload.candidateId, payload.locale);

    return result.checkpoint;
  };
  handlers.DEEP_VALIDATION = async (job) => {
    const payload = DeepValidationJobPayloadSchema.parse(job.payload);
    const apiBudget = budgetFor(job);

    const result = await runDeepValidation(payload.candidateId, payload.locale, {
      client,
      budget: apiBudget,
      queryKeyword: options.queryKeyword ?? createJungleScoutKeywordQuery(),
      enqueueResume: async (input) => {
        await queue.enqueueJob({
          type: 'DEEP_VALIDATION',
          payload: { candidateId: input.candidateId, locale: input.locale },
          idempotencyKey: input.idempotencyKey,
          availableAt: input.availableAt
        });
      }
    });


    if (result.completed) {
      await enqueueExplicitRequestedFollowups(payload.candidateId, payload.locale);
    }
    return result;
  };


  handlers.ENRICH_STRONG_POTENTIAL = async (job) => {
    const payload = EnrichStrongPotentialJobPayloadSchema.parse(job.payload);
    const apiBudget = budgetFor(job);

    return runEnrichStrongPotential(payload.candidateId, client, {
      budget: apiBudget,
      locale: payload.locale,
      queryHistoricalSearchVolume: createJungleScoutHistoricalSearchVolumeQuery(),
      querySalesEstimates: createJungleScoutSalesEstimatesQuery(),
      queryShareOfVoice: createJungleScoutShareOfVoiceQuery(),
      enqueueResume: async (input) => {
        await queue.enqueueJob({
          type: 'ENRICH_STRONG_POTENTIAL',
          payload: { candidateId: input.candidateId, locale: input.locale },
          idempotencyKey: input.idempotencyKey,
          availableAt: input.availableAt
        });
      }
    });
  };


  return handlers;
}
