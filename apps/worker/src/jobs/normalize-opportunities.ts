import { createHash } from 'node:crypto';
import {
  type AiProvider,
  type AiProviderResult
} from '@ara/ai-router';
import type { Database, Json } from '@ara/db';
import type { QueueDatabaseClient } from '@ara/queue';
import {
  buildNormalizationPrompt,
  KeywordNormalizationSchema,
  NORMALIZATION_PROMPT_VERSION,
  type KeywordNormalization
} from '@ara/research-engine';
import {
  AiRoleSchema,
  AiUsageSchema,
  BillingTypeSchema,
  LocaleSchema,
  type CandidateState,
  type Locale
} from '@ara/shared';

export interface NormalizeJobInput {
  readonly candidateIds: readonly string[];
  readonly locale: Locale;
}

export interface NormalizeJobDependencies {
  readonly client: QueueDatabaseClient;
  readonly provider: AiProvider;
  readonly modelId: string;
  readonly promptVersion?: string;
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

type CandidateRow = Database['public']['Tables']['candidates']['Row'];
type AnalysisRow = Database['public']['Tables']['ai_analyses']['Row'];
type DecisionReason = { readonly code: string; readonly detail: string };

export class NormalizationJobError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'NormalizationJobError';
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

function asJson(value: unknown): Json {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new NormalizationJobError('Normalization value could not be serialized.');
  }
  return JSON.parse(serialized) as Json;
}

function stringArray(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function mergeStrings(...values: readonly string[][]): string[] {
  return [...new Set(values.flat().map((value) => value.trim()).filter(Boolean))];
}

function inputHash(
  keyword: string,
  promptVersion: string
): string {
  return sha256(
    `niche_normalization\0${promptVersion}\0${normalizeExactKeyword(keyword)}`
  );
}

function isCapacityError(error: unknown): boolean {
  if (!(error instanceof Error) || !('retryable' in error)) {
    return false;
  }
  return typeof error.retryable === 'boolean' && error.retryable;
}

function targetState(output: KeywordNormalization): CandidateState {
  if (
    output.classification === 'brand_ip' ||
    output.classification === 'broad_query' ||
    output.classification === 'irrelevant'
  ) {
    return 'Reject';
  }
  if (
    output.classification === 'ambiguous' ||
    output.confidence < 0.7 ||
    output.canonicalNiche === null
  ) {
    return 'Needs Review';
  }
  return 'Ready for API Validation';
}

function aiReason(output: KeywordNormalization): DecisionReason {
  return {
    code: `AI_${output.classification.toLocaleUpperCase('en-US')}`,
    detail: output.reason
  };
}

function isJsonObject(
  value: Json
): value is { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function currentReasons(value: Json): DecisionReason[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isJsonObject(item) || typeof item.code !== 'string' || typeof item.detail !== 'string') {
      return [];
    }
    return [{ code: item.code, detail: item.detail }];
  });
}

function analysisResult(
  row: AnalysisRow,
  output: KeywordNormalization
): AiProviderResult<KeywordNormalization> {
  return {
    output,
    providerId: row.provider_id,
    modelId: row.model_id,
    role: AiRoleSchema.parse(row.role),
    inputHash: row.input_hash,
    usage: AiUsageSchema.parse(row.usage),
    costClass: BillingTypeSchema.parse(row.cost_class),
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
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
    .select(
      'id,import_run_id,representative_raw_keyword_id,keyword,normalized_exact_keyword,state,rule_passed,rule_reasons,risk_flags,eligible_for_ai_normalization,preliminary_score,preliminary_score_components,created_at,updated_at,niche_cluster_id'
    )
    .in('id', [...candidateIds]);
  if (error) {
    throw new NormalizationJobError('load normalization candidates.', error);
  }
  if (data.length !== candidateIds.length) {
    throw new NormalizationJobError('One or more normalization candidates were not found.');
  }
  return data;
}

async function loadExistingAnalysis(
  client: QueueDatabaseClient,
  hash: string
): Promise<AiProviderResult<KeywordNormalization> | null> {
  const { data, error } = await client
    .from('ai_analyses')
    .select('*')
    .eq('role', 'niche_normalization')
    .eq('input_hash', hash)
    .maybeSingle();
  if (error) {
    throw new NormalizationJobError('load existing AI analysis.', error);
  }
  if (!data) {
    return null;
  }
  const output = KeywordNormalizationSchema.safeParse(data.output);
  if (!output.success) {
    throw new NormalizationJobError('Stored AI analysis has invalid output.');
  }
  return analysisResult(data, output.data);
}

async function persistAnalysis(
  client: QueueDatabaseClient,
  candidate: CandidateRow,
  result: AiProviderResult<KeywordNormalization>,
  locale: Locale,
  promptVersion: string
): Promise<void> {
  const { data, error } = await client
    .from('ai_analyses')
    .upsert(
      {
        provider_id: result.providerId,
        model_id: result.modelId,
        role: result.role,
        locale,
        entity_type: 'candidate',
        entity_id: candidate.id,
        input_hash: result.inputHash,
        input_payload: asJson({
          keyword: candidate.keyword,
          normalizedExactKeyword: candidate.normalized_exact_keyword
        }),
        output: asJson(result.output),
        usage: asJson(result.usage),
        cost_class: result.costClass,
        prompt_version: promptVersion,
        started_at: result.startedAt,
        completed_at: result.completedAt
      },
      { onConflict: 'role,input_hash' }
    )
    .select('id')
    .single();
  if (error || !data) {
    throw new NormalizationJobError('persist AI analysis.', error);
  }

  const { error: usageError } = await client.from('ai_usage').upsert(
    {
      analysis_id: data.id,
      provider_id: result.providerId,
      model_id: result.modelId,
      role: result.role,
      input_hash: result.inputHash,
      usage: asJson(result.usage),
      cost_class: result.costClass,
      started_at: result.startedAt,
      completed_at: result.completedAt
    },
    { onConflict: 'analysis_id' }
  );
  if (usageError) {
    throw new NormalizationJobError('persist AI usage.', usageError);
  }
}

async function upsertCluster(
  client: QueueDatabaseClient,
  output: KeywordNormalization
): Promise<string> {
  if (!output.canonicalNiche) {
    throw new NormalizationJobError('A clusterable output needs a canonical niche.');
  }
  const { data: existing, error: existingError } = await client
    .from('niche_clusters')
    .select('id,aliases,catalog_phrases,canonical_english')
    .eq('canonical_name', output.canonicalNiche)
    .maybeSingle();
  if (existingError) {
    throw new NormalizationJobError('load niche cluster.', existingError);
  }

  const aliases = mergeStrings(
    stringArray(existing?.aliases),
    output.aliases
  );
  const catalogPhrases = mergeStrings(
    stringArray(existing?.catalog_phrases),
    output.catalogPhrases
  );
  const values = {
    canonical_name: output.canonicalNiche,
    canonical_english: output.canonicalEnglish ?? existing?.canonical_english ?? null,
    catalog_phrases: asJson(catalogPhrases),
    aliases: asJson(aliases),
    state: 'Ready for API Validation'
  };

  if (existing) {
    const { data, error } = await client
      .from('niche_clusters')
      .update(values)
      .eq('id', existing.id)
      .select('id')
      .single();
    if (error || !data) {
      throw new NormalizationJobError('update niche cluster.', error);
    }
    return data.id;
  }

  const { data, error } = await client
    .from('niche_clusters')
    .insert(values)
    .select('id')
    .single();
  if (error || !data) {
    throw new NormalizationJobError('create niche cluster.', error);
  }
  return data.id;
}

async function persistDecision(
  client: QueueDatabaseClient,
  candidate: CandidateRow,
  state: CandidateState,
  reasons: readonly DecisionReason[],
  hash: string,
  clusterId: string | null,
  promptVersion: string
): Promise<void> {
  const { error: candidateError } = await client
    .from('candidates')
    .update({
      state,
      niche_cluster_id: clusterId,
      rule_reasons: asJson(reasons)
    })
    .eq('id', candidate.id);
  if (candidateError) {
    throw new NormalizationJobError('update normalized candidate.', candidateError);
  }

  const { error: decisionError } = await client
    .from('decision_history')
    .upsert(
      {
        candidate_id: candidate.id,
        from_state: candidate.state,
        to_state: state,
        reasons: asJson(reasons),
        decided_by: promptVersion,
        idempotency_key: `ai-normalization:${hash}:${state}`
      },
      { onConflict: 'idempotency_key' }
    );
  if (decisionError) {
    throw new NormalizationJobError('persist normalized decision.', decisionError);
  }
}

async function persistClusterLink(
  client: QueueDatabaseClient,
  candidate: CandidateRow,
  clusterId: string
): Promise<void> {
  if (!candidate.representative_raw_keyword_id) {
    throw new NormalizationJobError('Clusterable candidate has no raw keyword reference.');
  }
  const { error } = await client.from('niche_cluster_keywords').upsert({
    niche_cluster_id: clusterId,
    raw_opportunity_keyword_id: candidate.representative_raw_keyword_id
  });
  if (error) {
    throw new NormalizationJobError('link raw keyword to niche cluster.', error);
  }
}

async function deferForCapacity(
  client: QueueDatabaseClient,
  candidate: CandidateRow,
  hash: string,
  promptVersion: string
): Promise<void> {
  const reasons = [
    ...currentReasons(candidate.rule_reasons),
    {
      code: 'AI_PROVIDER_UNAVAILABLE',
      detail: 'The configured AI provider is unavailable; retry when capacity returns.'
    }
  ];
  await persistDecision(
    client,
    candidate,
    'Waiting for AI Capacity',
    reasons,
    hash,
    null,
    promptVersion
  );
}

async function normalizeCandidate(
  input: NormalizeJobInput,
  dependencies: NormalizeJobDependencies,
  candidate: CandidateRow,
  promptVersion: string
): Promise<{ clustered: boolean; rejected: boolean; needsReview: boolean; deferred: boolean; reused: boolean }> {
  const hash = inputHash(candidate.keyword, promptVersion);
  const existing = await loadExistingAnalysis(dependencies.client, hash);
  let result: AiProviderResult<KeywordNormalization>;
  let reused = false;
  if (existing) {
    result = existing;
    reused = true;
  } else {
    try {
      const locale = LocaleSchema.parse(input.locale);
      result = await dependencies.provider.runStructured({
        role: 'niche_normalization',
        modelId: dependencies.modelId,
        locale,
        prompt: buildNormalizationPrompt(candidate.keyword, locale),
        inputHash: hash,
        schema: KeywordNormalizationSchema
      });
      await persistAnalysis(
        dependencies.client,
        candidate,
        result,
        locale,
        promptVersion
      );
    } catch (error) {
      if (!isCapacityError(error)) {
        throw error;
      }
      await deferForCapacity(
        dependencies.client,
        candidate,
        hash,
        promptVersion
      );
      return { clustered: false, rejected: false, needsReview: false, deferred: true, reused: false };
    }
  }

  const output = KeywordNormalizationSchema.parse(result.output);
  const state = targetState(output);
  const reasons = [...currentReasons(candidate.rule_reasons), aiReason(output)];
  if (state === 'Ready for API Validation') {
    const clusterId = await upsertCluster(dependencies.client, output);
    await persistClusterLink(dependencies.client, candidate, clusterId);
    await persistDecision(
      dependencies.client,
      candidate,
      state,
      reasons,
      hash,
      clusterId,
      promptVersion
    );
    return { clustered: true, rejected: false, needsReview: false, deferred: false, reused };
  }

  await persistDecision(
    dependencies.client,
    candidate,
    state,
    reasons,
    hash,
    null,
    promptVersion
  );
  return {
    clustered: false,
    rejected: state === 'Reject',
    needsReview: state === 'Needs Review',
    deferred: false,
    reused
  };
}

export async function runNormalizeJob(
  input: NormalizeJobInput,
  dependencies: NormalizeJobDependencies
): Promise<NormalizeJobResult> {
  const promptVersion = dependencies.promptVersion ?? NORMALIZATION_PROMPT_VERSION;
  const locale = LocaleSchema.parse(input.locale);
  const candidates = await loadCandidates(dependencies.client, input.candidateIds);
  let clusteredCount = 0;
  let rejectedCount = 0;
  let needsReviewCount = 0;
  let deferredCount = 0;
  let reusedAnalysisCount = 0;

  for (const [index, candidate] of candidates.entries()) {
    const result = await normalizeCandidate(
      { candidateIds: input.candidateIds, locale },
      dependencies,
      candidate,
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
