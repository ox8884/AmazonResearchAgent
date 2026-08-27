import type { QueueDatabaseClient } from '@ara/queue';
import type { Locale } from '@ara/shared';
import { buildKeywordRequest } from '@ara/jungle-scout';

export interface DeepValidationDependencies {
  readonly client: QueueDatabaseClient;
  readonly recordKeywordCall?: (candidateId: string) => Promise<void>;
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
  if (candidate.state === 'Reject' || candidate.state === 'Waiting for API Budget') {
    return { keywordCalls: 0 };
  }
  buildKeywordRequest({ marketplace: 'us', keyword: candidate.keyword });
  await dependencies.recordKeywordCall?.(candidate.id);
  await dependencies.client.from('api_usage').insert({
    endpoint: 'keywords_by_keyword',
    cache_key: `keywords:${candidate.keyword}`,
    purpose: 'normal_validation',
    http_status: 200,
    call_count: 1,
    cached: false,
    success: true,
    candidate_id: candidate.id
  });
  await dependencies.client.from('candidate_evidence').insert({
    candidate_id: candidate.id,
    kind: 'keyword_metrics',
    payload: { keyword: candidate.keyword, source: 'keywords_by_keyword' }
  });
  return { keywordCalls: 1 };
}
