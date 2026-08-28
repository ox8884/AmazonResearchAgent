import type { QueueDatabaseClient } from '@ara/queue';
import { makeApiCacheKey, type ApiCallPurpose, type Locale } from '@ara/shared';
import { authorizeApiCall, DEFAULT_CACHE_TTL_MS, type ApiBudget } from '@ara/api-budget';
import type { KeywordMetrics } from '@ara/jungle-scout';
import { nextBudgetResetAt } from './market-probe';

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


function assertNever(value: never): never {
  throw new Error(`Unhandled authorization decision: ${JSON.stringify(value)}`);
}

export async function runDeepValidation(
  candidateId: string,
  locale: Locale,
  dependencies: DeepValidationDependencies
): Promise<{ keywordCalls: number }> {
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
    return { keywordCalls: 0 };
  }
  if (!dependencies.budget || !dependencies.queryKeyword) {
    return { keywordCalls: 0 };
  }

  const cacheKey = makeApiCacheKey({
    endpoint: 'keywords_by_keyword',
    marketplace: 'us',
    phrases: [candidate.keyword]
  });
  const purpose = dependencies.purpose ?? 'normal_validation';
  const decision = await authorizeApiCall(dependencies.budget, {
    purpose,
    estimatedCalls: 1,
    cacheKey,
    endpoint: 'keywords_by_keyword'
  });

  switch (decision.kind) {
    case 'blocked_policy':
      return { keywordCalls: 0 };
    case 'deferred_budget':
    case 'in_flight': {
      const availableAt =
        decision.kind === 'deferred_budget'
          ? nextBudgetResetAt()
          : new Date(Date.now() + 15_000).toISOString();
      await dependencies.enqueueResume?.({
        candidateId: candidate.id,
        locale,
        availableAt,
        idempotencyKey:
          decision.kind === 'deferred_budget'
            ? `deep-validation-resume:${candidate.id}:${availableAt.slice(0, 10)}`
            : `deep-validation-inflight:${candidate.id}:${cacheKey}`
      });
      return { keywordCalls: 0 };
    }
    case 'cache_hit': {
      const { data: cached } = await dependencies.client
        .from('api_cache')
        .select('response')
        .eq('cache_key', cacheKey)
        .maybeSingle();
      if (cached?.response) {
        const { error: evidenceError } = await dependencies.client.from('candidate_evidence').insert({
          candidate_id: candidate.id,
          kind: 'keyword_metrics',
          payload: cached.response
        });
        if (evidenceError) {
          throw new Error(`Could not persist keyword evidence: ${evidenceError.message}`);
        }
      }
      return { keywordCalls: 0 };
    }
    case 'allowed': {
      const metrics = await dependencies.queryKeyword(candidate.keyword);
      const httpAttempts = metrics.httpAttempts ?? 1;
      const status = metrics.status ?? 200;
      await dependencies.budget.stage?.(cacheKey, {
        metrics,
        httpAttempts,
        status
      });
      const { error: cacheError } = await dependencies.client.from('api_cache').upsert({
        cache_key: cacheKey,
        endpoint: 'keywords_by_keyword',
        response: metrics,
        captured_at: new Date().toISOString(),
        expires_at: new Date(
          Date.now() + DEFAULT_CACHE_TTL_MS.keywords_by_keyword
        ).toISOString()
      });
      if (cacheError) {
        throw new Error(`Could not persist keyword cache: ${cacheError.message}`);
      }
      const { error: usageError } = await dependencies.client.from('api_usage').insert({
        endpoint: 'keywords_by_keyword',
        cache_key: cacheKey,
        purpose,
        http_status: status,
        call_count: httpAttempts,
        retry_count: Math.max(0, httpAttempts - 1),
        cached: false,
        success: true,
        candidate_id: candidate.id
      });
      if (usageError) {
        throw new Error(`Could not persist keyword usage: ${usageError.message}`);
      }
      const { error: evidenceError } = await dependencies.client.from('candidate_evidence').insert({
        candidate_id: candidate.id,
        kind: 'keyword_metrics',
        payload: metrics
      });
      if (evidenceError) {
        throw new Error(`Could not persist keyword evidence: ${evidenceError.message}`);
      }
      await dependencies.budget.complete?.(cacheKey);
      return { keywordCalls: httpAttempts };
    }
    default:
      return assertNever(decision);
  }
}
