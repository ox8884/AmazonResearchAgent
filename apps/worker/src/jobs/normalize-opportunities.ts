import { createHash } from 'node:crypto';
import type { ProviderCatalog } from '@ara/ai-router';
import type { JobLeaseIdentity } from '@ara/db';
import type { QueueDatabaseClient } from '@ara/queue';
import {
  buildNormalizationPrompt,
  NORMALIZATION_PROMPT_VERSION
} from '@ara/research-engine';
import { LocaleSchema, type Locale } from '@ara/shared';
import type { NormalizationExecutionCoordinator } from '../providers/normalization-execution-coordinator';

export interface NormalizeJobInput {
  readonly candidateIds: readonly string[];
  readonly locale: Locale;
  readonly normalizationGeneration: number;
}

export interface NormalizeJobDependencies {
  readonly client: QueueDatabaseClient;
  readonly coordinator: NormalizationExecutionCoordinator;
  readonly catalog: ProviderCatalog;
  readonly jobLease: JobLeaseIdentity;
  readonly signal: AbortSignal;
  readonly workerId?: string;
  readonly promptVersion?: string;
  readonly leaseSeconds?: number;
  readonly heartbeatMs?: number;
  onCheckpoint?(checkpoint: NormalizeCheckpoint): Promise<void>;
}

export type NormalizePhase = 'normalized' | 'completed';

export interface NormalizeCheckpoint {
  readonly phase: NormalizePhase;
  readonly processedCandidateCount: number;
}

export interface NormalizeJobResult {
  readonly processedCount: number;
  readonly clusteredCount: number;
  readonly rejectedCount: number;
  readonly needsReviewCount: number;
  readonly deferredCount: number;
  readonly reusedAnalysisCount: number;
  readonly checkpoint: NormalizeCheckpoint;
}

type CandidateRow = {
  readonly id: string;
  readonly keyword: string;
  readonly normalized_exact_keyword: string;
  readonly state: string;
  readonly normalization_generation: number;
};

type AnalysisClaim =
  | {
      readonly analysisId: string;
      readonly status: 'claimed';
      readonly analysisLeaseEpoch: number;
    }
  | {
      readonly analysisId: string;
      readonly status: 'completed' | 'busy';
      readonly analysisLeaseEpoch: null;
    };

export class NormalizationJobError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'NormalizationJobError';
  }
}

class AnalysisClaimBusyError extends Error {
  readonly retryable = true;

  constructor() {
    super('AI analysis is already leased by another worker.');
    this.name = 'AnalysisClaimBusyError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeExactKeyword(keyword: string): string {
  return keyword
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .trim()
    .replace(/\s+/g, ' ');
}

function inputHash(
  candidate: CandidateRow,
  promptVersion: string,
  locale: Locale
): string {
  return sha256([
    'niche_normalization', promptVersion, locale, candidate.id,
    String(candidate.normalization_generation), normalizeExactKeyword(candidate.keyword)
  ].join('\0'));
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Normalization cancelled.', 'AbortError');
}

async function provisionalIdentity(
  client: QueueDatabaseClient,
  catalog: ProviderCatalog
): Promise<{ readonly providerId: string; readonly modelId: string }> {
  for (const entry of catalog.entries) {
    const model = entry.models[0];
    if (model) return { providerId: entry.provider.id, modelId: model.id };
  }
  const { data: providers, error: providerError } = await client
    .from('ai_providers')
    .select('id,billing_type')
    .neq('billing_type', 'payg')
    .order('priority', { ascending: true });
  if (providerError) throw new NormalizationJobError('load provisional provider metadata.', providerError);
  for (const provider of providers) {
    const { data: models, error: modelError } = await client
      .from('ai_models')
      .select('model_id')
      .eq('provider_id', provider.id)
      .neq('billing_type', 'payg')
      .order('priority', { ascending: true })
      .limit(1);
    if (modelError) throw new NormalizationJobError('load provisional model metadata.', modelError);
    const model = models[0];
    if (model) return { providerId: provider.id, modelId: model.model_id };
  }
  throw new NormalizationJobError('No persisted non-PAYG provider metadata is available to claim the analysis.');
}

async function loadCandidates(
  client: QueueDatabaseClient,
  candidateIds: readonly string[]
): Promise<readonly CandidateRow[]> {
  if (candidateIds.length === 0) {
    throw new NormalizationJobError('At least one candidate id is required.');
  }
  const { data, error } = await client
    .from('candidates')
    .select('id,keyword,normalized_exact_keyword,state,normalization_generation')
    .in('id', [...candidateIds]);
  if (error) throw new NormalizationJobError('load normalization candidates.', error);
  if (data.length !== candidateIds.length) {
    throw new NormalizationJobError('One or more normalization candidates were not found.');
  }
  return data;
}

async function claimAnalysis(
  client: QueueDatabaseClient,
  candidate: CandidateRow,
  hash: string,
  locale: Locale,
  dependencies: NormalizeJobDependencies,
  promptVersion: string
): Promise<AnalysisClaim> {
  const workerId = dependencies.workerId ?? `normalizer-${process.pid}`;
  const provisional = await provisionalIdentity(client, dependencies.catalog);
  const { data, error } = await client.rpc('claim_ai_analysis', {
    analysis_role: 'niche_normalization',
    analysis_input_hash: hash,
    worker_id: workerId,
    lease_seconds: dependencies.leaseSeconds ?? 120,
    provider_id: provisional.providerId,
    model_id: provisional.modelId,
    analysis_locale: locale,
    prompt_version: promptVersion,
    input_payload: {
      candidateId: candidate.id,
      normalizationGeneration: candidate.normalization_generation,
      keyword: candidate.keyword,
      normalizedExactKeyword: candidate.normalized_exact_keyword
    }
  });
  const claim = data?.[0];
  if (error || !claim) throw new NormalizationJobError('claim AI analysis.', error);
  if (claim.claim_status === 'busy' || claim.claim_status === 'completed') {
    return {
      analysisId: claim.analysis_id,
      status: claim.claim_status,
      analysisLeaseEpoch: null
    };
  }
  if (
    claim.claim_status !== 'claimed' ||
    !Number.isSafeInteger(claim.analysis_lease_epoch) ||
    claim.analysis_lease_epoch < 1
  ) {
    throw new NormalizationJobError('AI analysis claim returned an invalid lease epoch.');
  }
  return {
    analysisId: claim.analysis_id,
    status: 'claimed',
    analysisLeaseEpoch: claim.analysis_lease_epoch
  };
}

async function renewAnalysisLease(
  client: QueueDatabaseClient,
  analysisId: string,
  owner: string,
  epoch: number,
  leaseSeconds: number
): Promise<boolean> {
  const { data, error } = await client.rpc('renew_ai_analysis_lease', {
    analysis_id: analysisId,
    worker_id: owner,
    analysis_lease_epoch: epoch,
    lease_seconds: leaseSeconds
  });
  if (error) throw new NormalizationJobError('renew AI analysis lease.', error);
  return data === true;
}

async function withAnalysisHeartbeat<T>(
  dependencies: NormalizeJobDependencies,
  analysisId: string,
  owner: string,
  epoch: number,
  work: () => Promise<T>
): Promise<T> {
  const leaseSeconds = dependencies.leaseSeconds ?? 120;
  const heartbeatMs = dependencies.heartbeatMs ?? 30_000;
  const timer = setInterval(() => {
    void renewAnalysisLease(dependencies.client, analysisId, owner, epoch, leaseSeconds)
      .then((owned) => {
        if (!owned) clearInterval(timer);
      });
  }, heartbeatMs);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

function counters(
  result: Awaited<ReturnType<NormalizationExecutionCoordinator['execute']>>,
  reused: boolean
): {
  readonly clustered: boolean;
  readonly rejected: boolean;
  readonly needsReview: boolean;
  readonly deferred: boolean;
  readonly reused: boolean;
} {
  return {
    clustered: result.kind === 'finalized' && result.targetState === 'Ready for API Validation',
    rejected: result.kind === 'finalized' && result.targetState === 'Reject',
    needsReview: result.kind === 'finalized' && result.targetState === 'Needs Review',
    deferred: result.kind === 'deferred',
    reused
  };
}

async function normalizeCandidate(
  input: NormalizeJobInput,
  dependencies: NormalizeJobDependencies,
  candidate: CandidateRow,
  promptVersion: string
): Promise<ReturnType<typeof counters>> {
  if (dependencies.signal.aborted) throw abortReason(dependencies.signal);
  const locale = LocaleSchema.parse(input.locale);
  const hash = inputHash(candidate, promptVersion, locale);
  const owner = dependencies.workerId ?? `normalizer-${process.pid}`;
  const claim = await claimAnalysis(
    dependencies.client,
    candidate,
    hash,
    locale,
    dependencies,
    promptVersion
  );
  if (claim.status === 'busy') throw new AnalysisClaimBusyError();
  if (claim.status === 'completed') {
    const result = await dependencies.coordinator.finalizeCompleted({
      jobLease: dependencies.jobLease,
      analysisId: claim.analysisId,
      analysisLeaseOwner: owner,
      leaseSeconds: dependencies.leaseSeconds ?? 120,
      candidateId: candidate.id,
      expectedCandidateState: 'AI Screening',
      normalizationGeneration: candidate.normalization_generation
    });
    if (result.kind === 'already_finalized') {
      return {
        clustered: candidate.state === 'Ready for API Validation',
        rejected: candidate.state === 'Reject',
        needsReview: candidate.state === 'Needs Review',
        deferred: candidate.state === 'Waiting for AI Capacity',
        reused: true
      };
    }
    return counters(result, true);
  }
  if (claim.analysisLeaseEpoch === null) {
    throw new NormalizationJobError('Claimed analysis has no lease epoch.');
  }

  const analysisLeaseEpoch: number = claim.analysisLeaseEpoch;
  const result = await withAnalysisHeartbeat(
    dependencies,
    claim.analysisId,
    owner,
    analysisLeaseEpoch,
    () => dependencies.coordinator.execute({
      jobLease: dependencies.jobLease,
      analysisLease: {
        analysisId: claim.analysisId,
        owner,
        epoch: analysisLeaseEpoch
      },
      candidateId: candidate.id,
      expectedCandidateState: 'AI Screening',
      normalizationGeneration: candidate.normalization_generation,
      locale,
      prompt: buildNormalizationPrompt(candidate.keyword, locale),
      inputHash: hash,
      catalog: dependencies.catalog,
      signal: dependencies.signal
    })
  );
  return counters(result, false);
}

export async function runNormalizeJob(
  input: NormalizeJobInput,
  dependencies: NormalizeJobDependencies
): Promise<NormalizeJobResult> {
  if (input.candidateIds.length !== 1) {
    throw new NormalizationJobError('Normalization jobs must contain exactly one candidate id.');
  }
  const promptVersion = dependencies.promptVersion ?? NORMALIZATION_PROMPT_VERSION;
  const locale = LocaleSchema.parse(input.locale);
  const candidates = await loadCandidates(dependencies.client, input.candidateIds);
  const candidate = candidates[0];
  if (!candidate || candidate.normalization_generation !== input.normalizationGeneration) {
    throw new NormalizationJobError('Normalization payload generation does not match the candidate.');
  }
  let clusteredCount = 0;
  let rejectedCount = 0;
  let needsReviewCount = 0;
  let deferredCount = 0;
  let reusedAnalysisCount = 0;

  for (const [index, currentCandidate] of candidates.entries()) {
    const result = await normalizeCandidate(
      input,
      dependencies,
      currentCandidate,
      promptVersion
    );
    clusteredCount += result.clustered ? 1 : 0;
    rejectedCount += result.rejected ? 1 : 0;
    needsReviewCount += result.needsReview ? 1 : 0;
    deferredCount += result.deferred ? 1 : 0;
    reusedAnalysisCount += result.reused ? 1 : 0;
    await dependencies.onCheckpoint?.({
      phase: 'normalized',
      processedCandidateCount: index + 1
    });
  }

  const checkpoint: NormalizeCheckpoint = {
    phase: 'completed',
    processedCandidateCount: candidates.length
  };
  await dependencies.onCheckpoint?.(checkpoint);
  return {
    processedCount: candidates.length,
    clusteredCount,
    rejectedCount,
    needsReviewCount,
    deferredCount,
    reusedAnalysisCount,
    checkpoint
  };
}
