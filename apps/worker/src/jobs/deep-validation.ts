import type { QueueDatabaseClient } from '@ara/queue';
import { makeApiCacheKey, type ApiCallPurpose, type Locale } from '@ara/shared';
import { authorizeApiCall, type ApiBudget } from '@ara/api-budget';
import type { KeywordMetrics } from '@ara/jungle-scout';

export interface DeepValidationDependencies {
  readonly client: QueueDatabaseClient;
  readonly budget?: ApiBudget;
  readonly purpose?: ApiCallPurpose;
  readonly queryKeyword?: (keyword: string) => Promise<KeywordMetrics>;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled authorization decision: ${JSON.stringify(value)}`);
}

export async function runDeepValidation(
  candidateId: string,
  locale: Locale,
  dependencies: DeepValidationDependencies
): Promise<{ keywordCalls: number }> {
  void locale;
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
    case 'deferred_budget':
    case 'cache_hit':
    case 'in_flight':
      return { keywordCalls: 0 };

    case 'allowed': {
      const metrics = await dependencies.queryKeyword(candidate.keyword);
      const { error: usageError } = await dependencies.client.from('api_usage').insert({
        endpoint: 'keywords_by_keyword',
        cache_key: cacheKey,
        purpose,
        http_status: 200,
        call_count: 1,
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
      return { keywordCalls: 1 };
    }
    default:
      return assertNever(decision);
  }
}
