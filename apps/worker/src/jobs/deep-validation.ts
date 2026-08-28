import type { QueueDatabaseClient } from '@ara/queue';
import type { Json } from '@ara/db';
import { makeApiCacheKey, type ApiCallPurpose, type Locale } from '@ara/shared';
import { DEFAULT_CACHE_TTL_MS, type ApiBudget } from '@ara/api-budget';
import type { KeywordMetrics } from '@ara/jungle-scout';
import { executeBudgetedApiCall } from './budgeted-api-call';

export interface DeepValidationDependencies {
  readonly client: QueueDatabaseClient;
  readonly budget?: ApiBudget;
  readonly purpose?: ApiCallPurpose;
  readonly queryKeyword?: (
    keyword: string
  ) => Promise<KeywordMetrics & { readonly httpAttempts?: number; readonly status?: number }>;
  enqueueResume?(input: {
    readonly candidateId: string;
    readonly locale: Locale;
    readonly availableAt: string;
    readonly idempotencyKey: string;
  }): Promise<void>;
}

export interface DeepValidationResult {
  readonly keywordCalls: number;
  readonly completed: boolean;
  readonly outcome:
    | 'skipped'
    | 'blocked_policy'
    | 'deferred_budget'
    | 'in_flight'
    | 'completed';
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export async function runDeepValidation(
  candidateId: string,
  locale: Locale,
  dependencies: DeepValidationDependencies
): Promise<DeepValidationResult> {
  const { data: candidate, error } = await dependencies.client
    .from('candidates')
    .select('id,state,keyword')
    .eq('id', candidateId)
    .single();
  if (error || !candidate) {
    throw new Error('Deep validation candidate was not found.');
  }
  if (
    candidate.state === 'Reject' ||
    candidate.state === 'Waiting for API Budget' ||
    (candidate.state !== 'Watch' && candidate.state !== 'Needs Review')
  ) {
    return { keywordCalls: 0, completed: false, outcome: 'skipped' };
  }
  if (!dependencies.budget || !dependencies.queryKeyword) {
    return { keywordCalls: 0, completed: false, outcome: 'skipped' };
  }

  const cacheKey = makeApiCacheKey({
    endpoint: 'keywords_by_keyword',
    marketplace: 'us',
    phrases: [candidate.keyword]
  });
  const purpose = dependencies.purpose ?? 'normal_validation';
  const queryKeyword = dependencies.queryKeyword;
  const outcome = await executeBudgetedApiCall({
    client: dependencies.client,
    budget: dependencies.budget,
    candidateId: candidate.id,
    endpoint: 'keywords_by_keyword',
    cacheKey,
    purpose,
    ttlMs: DEFAULT_CACHE_TTL_MS.keywords_by_keyword,
    query: async () => {
      const metrics = await queryKeyword(candidate.keyword);
      return {
        payload: metrics,
        httpAttempts: metrics.httpAttempts ?? 1,
        status: metrics.status ?? 200
      };
    }
  });

  if (outcome.kind === 'blocked_policy') {
    return { keywordCalls: 0, completed: false, outcome: 'blocked_policy' };
  }
  if (outcome.kind === 'deferred_budget' || outcome.kind === 'in_flight') {
    await dependencies.enqueueResume?.({
      candidateId: candidate.id,
      locale,
      availableAt: outcome.availableAt,
      idempotencyKey:
        outcome.kind === 'deferred_budget'
          ? `deep-validation-resume:${candidate.id}:${outcome.availableAt.slice(0, 10)}`
          : `deep-validation-inflight:${candidate.id}:${cacheKey}`
    });
    return { keywordCalls: 0, completed: false, outcome: outcome.kind };
  }

  if (outcome.payload != null) {
    const { error: evidenceError } = await dependencies.client.from('candidate_evidence').insert({
      candidate_id: candidate.id,
      kind: 'keyword_metrics',
      payload: asJson(outcome.payload)
    });
    if (evidenceError) {
      throw new Error(`Could not persist keyword evidence: ${evidenceError.message}`);
    }
  }

  return {
    keywordCalls: outcome.fromCache ? 0 : outcome.httpAttempts,
    completed: true,
    outcome: 'completed'
  };
}
