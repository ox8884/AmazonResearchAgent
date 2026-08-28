import type { ApiBudget } from '@ara/api-budget';
import { authorizeApiCall, DEFAULT_CACHE_TTL_MS } from '@ara/api-budget';
import { makeApiCacheKey } from '@ara/shared';
import type { QueueDatabaseClient } from '@ara/queue';
import type {
  HistoricalSearchVolumeQueryResult,
  SalesEstimatesQueryResult,
  ShareOfVoiceQueryResult
} from '@ara/jungle-scout';


export interface EnrichStrongPotentialOptions {
  readonly budget?: ApiBudget;
  readonly keyword?: string;
  readonly asins?: readonly string[];
  readonly queryHistoricalSearchVolume?: (
    keyword: string
  ) => Promise<HistoricalSearchVolumeQueryResult>;
  readonly querySalesEstimates?: (asins: readonly string[]) => Promise<SalesEstimatesQueryResult>;
  readonly queryShareOfVoice?: (keyword: string) => Promise<ShareOfVoiceQueryResult>;
}

export async function runEnrichStrongPotential(
  candidateId: string,
  client: QueueDatabaseClient,
  options: EnrichStrongPotentialOptions = {}
): Promise<{ differentiationMode: 'listing_proxy' | 'missing' }> {
  const { data: candidate, error } = await client
    .from('candidates')
    .select('id,state,keyword,niche_cluster_id')
    .eq('id', candidateId)
    .single();
  if (error || !candidate) {
    throw new Error('Enrichment candidate was not found.');
  }
  if (candidate.state !== 'Watch') {
    return { differentiationMode: 'missing' };
  }

  const keyword = options.keyword ?? candidate.keyword;
  const budget = options.budget;
  if (!budget || !keyword) {
    return { differentiationMode: 'missing' };
  }

  let asins = options.asins ? [...options.asins] : [];
  if (asins.length === 0 && candidate.niche_cluster_id) {
    const { data: products, error: productError } = await client
      .from('products')
      .select('asin')
      .eq('niche_cluster_id', candidate.niche_cluster_id)
      .order('asin', { ascending: true })
      .limit(20);
    if (productError) {
      throw new Error(`Could not load Sales Estimates ASINs: ${productError.message}`);
    }
    asins = (products ?? [])
      .map((product) => product.asin)
      .filter((asin): asin is string => typeof asin === 'string' && asin.length > 0);
  }
  asins = [...new Set(asins)];





  if (options.queryHistoricalSearchVolume) {
    const queryHistorical = options.queryHistoricalSearchVolume;
    await persistEndpoint({
      client,
      budget,
      candidateId,
      endpoint: 'historical_search_volume',
      phrases: [keyword],
      query: async () => queryHistorical(keyword)
    });
  }
  if (options.querySalesEstimates && asins.length > 0) {
    const querySales = options.querySalesEstimates;
    await persistEndpoint({
      client,
      budget,
      candidateId,
      endpoint: 'sales_estimates',
      phrases: asins,
      query: async () => querySales(asins)
    });
  }

  if (options.queryShareOfVoice) {
    const queryShare = options.queryShareOfVoice;
    await persistEndpoint({
      client,
      budget,
      candidateId,
      endpoint: 'share_of_voice',
      phrases: [keyword],
      query: async () => queryShare(keyword)
    });
  }

  const { error: economicsError } = await client.from('candidate_evidence').insert({
    candidate_id: candidateId,
    kind: 'economics',
    payload: {
      economicsSource: 'estimated_assumption',
      salePrice: null,
      amazonFees: null,
      differentiationEvidenceMode: 'missing',
      note: 'Allowable landed cost is not computed without observed sale price and Amazon fees.'
    }
  });
  if (economicsError) {
    throw new Error(`Could not persist economics evidence: ${economicsError.message}`);
  }

  return { differentiationMode: 'missing' };
}

async function persistEndpoint(input: {
  readonly client: QueueDatabaseClient;
  readonly budget: ApiBudget;
  readonly candidateId: string;
  readonly endpoint: 'historical_search_volume' | 'sales_estimates' | 'share_of_voice';
  readonly phrases: readonly string[];
  readonly query?: () => Promise<
    | HistoricalSearchVolumeQueryResult
    | SalesEstimatesQueryResult
    | ShareOfVoiceQueryResult
    | undefined
  >;
}): Promise<void> {
  if (!input.query) {
    return;
  }
  const cacheKey = makeApiCacheKey({
    endpoint: input.endpoint,
    marketplace: 'us',
    phrases: [...input.phrases],
    version: 'v1'
  });
  const decision = await authorizeApiCall(input.budget, {
    purpose: 'strong_revalidation',
    estimatedCalls: 1,
    cacheKey,
    endpoint: input.endpoint
  });
  if (decision.kind !== 'allowed' && decision.kind !== 'cache_hit') {
    return;
  }
  if (decision.kind === 'cache_hit') {
    return;
  }
  const fetched = await input.query();
  if (!fetched) {
    return;
  }
  await input.budget.stage?.(cacheKey, {
    data: fetched.data,
    status: fetched.status,
    httpAttempts: fetched.httpAttempts
  });
  const { error: cacheError } = await input.client.from('api_cache').upsert({
    cache_key: cacheKey,
    endpoint: input.endpoint,
    response: fetched.data,
    captured_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + DEFAULT_CACHE_TTL_MS[input.endpoint]).toISOString()
  });
  if (cacheError) {
    throw new Error(`Could not persist API cache: ${cacheError.message}`);
  }

  const { error: usageError } = await input.client.from('api_usage').insert({
    endpoint: input.endpoint,
    cache_key: cacheKey,
    purpose: 'strong_revalidation',
    http_status: fetched.status,
    call_count: fetched.httpAttempts,
    retry_count: Math.max(0, fetched.httpAttempts - 1),
    cached: false,
    success: true,
    candidate_id: input.candidateId,
    budget_date: new Date().toISOString().slice(0, 10)
  });
  if (usageError) {
    throw new Error(`Could not persist API usage: ${usageError.message}`);
  }
  const { error: evidenceError } = await input.client.from('candidate_evidence').insert({
    candidate_id: input.candidateId,
    kind: input.endpoint,
    payload: fetched.data
  });
  if (evidenceError) {
    throw new Error(`Could not persist enrichment evidence: ${evidenceError.message}`);
  }
  await input.budget.complete?.(cacheKey);
}
