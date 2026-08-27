import type { QueueDatabaseClient } from '@ara/queue';
import type { Json } from '@ara/db';
import {
  makeApiCacheKey,
  type ApiCallPurpose,
  type Locale
} from '@ara/shared';
import {
  MemoryApiBudget,
  authorizeApiCall
} from '@ara/api-budget';
import {
  ProductDatabasePageSchema,
  type ProductDatabasePage
} from '@ara/jungle-scout';
import {
  calculateMarketMetrics,
  clusterMicroNiches,
  groupProductFamilies,
  scoreMarketOpportunity,
  type CatalogProduct
} from '@ara/research-engine';

export type MarketProbePhase =
  | 'budget_authorized'
  | 'api_fetched'
  | 'families_persisted'
  | 'relevance_filtered'
  | 'micro_niches_created'
  | 'metrics_scored'
  | 'completed'
  | 'deferred_budget';

export interface MarketProbeCheckpoint {
  readonly phase: MarketProbePhase;
  readonly cacheKey?: string;
}

export interface MarketProbeDependencies {
  readonly client: QueueDatabaseClient;
  readonly budget: MemoryApiBudget;
  readonly purpose?: ApiCallPurpose;
  readonly queryProductDatabase: (phrases: readonly string[]) => Promise<ProductDatabasePage>;
  onCheckpoint?(checkpoint: MarketProbeCheckpoint): Promise<void>;
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function toCatalog(page: ProductDatabasePage): CatalogProduct[] {
  return page.data.map((product) => ({
    id: product.id,
    title: product.attributes.title,
    parentAsin: product.attributes.parent_asin,
    unitsSold30: product.attributes.units_sold_30 ?? null,
    revenue30: product.attributes.revenue_30 ?? null,
    price: product.attributes.price,
    reviews: product.attributes.reviews ?? null,
    rating: product.attributes.rating ?? null,
    brand: product.attributes.brand ?? null,
    weight: product.attributes.weight ?? null,
    updatedAt: product.attributes.updated_at ?? null
  }));
}

async function persistDecision(
  client: QueueDatabaseClient,
  candidateId: string,
  fromState: string,
  toState: string,
  reasons: readonly { code: string; detail: string }[]
): Promise<void> {
  const { error: candidateError } = await client
    .from('candidates')
    .update({ state: toState, rule_reasons: asJson(reasons) })
    .eq('id', candidateId);
  if (candidateError) {
    throw new Error(`Could not update candidate state: ${candidateError.message}`);
  }
  const { error } = await client.from('decision_history').insert({
    candidate_id: candidateId,
    from_state: fromState,
    to_state: toState,
    reasons: asJson(reasons),
    decided_by: 'market-probe',
    idempotency_key: `market-probe:${candidateId}:${toState}`
  });
  if (error && error.code !== '23505') {
    throw new Error(`Could not persist decision: ${error.message}`);
  }
}

export async function runMarketProbe(
  input: { candidateId: string; locale: Locale },
  dependencies: MarketProbeDependencies
): Promise<{ checkpoint: MarketProbeCheckpoint; realCalls: number }> {
  const purpose = dependencies.purpose ?? 'normal_validation';
  const { data: candidate, error: candidateError } = await dependencies.client
    .from('candidates')
    .select('id,state,niche_cluster_id,keyword')
    .eq('id', input.candidateId)
    .single();
  if (candidateError || !candidate) {
    throw new Error('Market probe candidate was not found.');
  }
  let phrases: string[] = [candidate.keyword];
  if (candidate.niche_cluster_id) {
    const { data: cluster } = await dependencies.client
      .from('niche_clusters')
      .select('catalog_phrases,canonical_name')
      .eq('id', candidate.niche_cluster_id)
      .maybeSingle();
    const catalog = cluster?.catalog_phrases;
    if (Array.isArray(catalog)) {
      phrases = catalog.filter((item): item is string => typeof item === 'string');
    }
  }
  const cacheKey = makeApiCacheKey({
    endpoint: 'product_database',
    marketplace: 'us',
    phrases
  });
  const decision = await authorizeApiCall(dependencies.budget, {
    purpose,
    estimatedCalls: 1,
    cacheKey,
    endpoint: 'product_database'
  });
  if (decision.kind === 'deferred_budget') {
    await persistDecision(
      dependencies.client,
      candidate.id,
      candidate.state,
      'Waiting for API Budget',
      [{ code: 'API_BUDGET_EXHAUSTED', detail: 'Daily Jungle Scout reserve is preserved.' }]
    );
    const checkpoint = { phase: 'deferred_budget' as const, cacheKey };
    await dependencies.onCheckpoint?.(checkpoint);
    return { checkpoint, realCalls: 0 };
  }

  await dependencies.onCheckpoint?.({ phase: 'budget_authorized', cacheKey });
  let page: ProductDatabasePage;
  let realCalls = 0;
  if (decision.kind === 'cache_hit') {
    const { data: cached } = await dependencies.client
      .from('api_cache')
      .select('response')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    page = ProductDatabasePageSchema.parse(cached?.response ?? { data: [] });
  } else {
    page = await dependencies.queryProductDatabase(phrases);
    realCalls = 1;
    const { error: cacheError } = await dependencies.client.from('api_cache').upsert({
      cache_key: cacheKey,
      endpoint: 'product_database',
      response: asJson(page),
      captured_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
    if (cacheError) {
      throw new Error(`Could not persist API cache: ${cacheError.message}`);
    }
    const { error: usageError } = await dependencies.client.from('api_usage').insert({
      endpoint: 'product_database',
      cache_key: cacheKey,
      purpose,
      http_status: 200,
      call_count: 1,
      retry_count: 0,
      cached: false,
      success: true,
      candidate_id: candidate.id,
      niche_cluster_id: candidate.niche_cluster_id,
      budget_date: new Date().toISOString().slice(0, 10)
    });
    if (usageError) {
      throw new Error(`Could not persist API usage: ${usageError.message}`);
    }
  }
  await dependencies.onCheckpoint?.({ phase: 'api_fetched', cacheKey });

  const families = groupProductFamilies(toCatalog(page));
  for (const family of families) {
    const { data: familyRow, error: familyError } = await dependencies.client
      .from('product_families')
      .upsert(
        {
          niche_cluster_id: candidate.niche_cluster_id,
          parent_key: family.parentKey,
          observed_monthly_units: family.observedMonthlyUnits,
          observed_monthly_revenue: family.observedMonthlyRevenue,
          variant_count: family.variants.length,
          quality_notes: asJson(family.qualityNotes)
        },
        { onConflict: 'niche_cluster_id,parent_key' }
      )
      .select('id')
      .single();
    if (familyError || !familyRow) {
      throw new Error('Could not persist product family.');
    }
    for (const variant of family.variants) {
      await dependencies.client.from('products').upsert({
        product_family_id: familyRow.id,
        niche_cluster_id: candidate.niche_cluster_id,
        asin: variant.id,
        parent_asin: variant.parentAsin,
        title: variant.title,
        brand: variant.brand,
        price: variant.price,
        reviews: variant.reviews,
        rating: variant.rating,
        attributes: asJson(variant)
      });
    }
  }
  await dependencies.onCheckpoint?.({ phase: 'families_persisted', cacheKey });

  const clusters = clusterMicroNiches(families, candidate.keyword);
  await dependencies.onCheckpoint?.({ phase: 'relevance_filtered', cacheKey });
  await dependencies.client.from('candidate_evidence').insert({
    candidate_id: candidate.id,
    kind: 'micro_niches',
    payload: asJson(clusters.map((cluster) => cluster.name))
  });
  await dependencies.onCheckpoint?.({ phase: 'micro_niches_created', cacheKey });

  const metrics = calculateMarketMetrics(families);
  const score = scoreMarketOpportunity({
    metrics,
    hardFilterFailed: false,
    marginProvisional: true,
    differentiationMode: 'missing',
    ipRisk: false
  });
  await dependencies.client.from('market_snapshots').insert({
    niche_cluster_id: candidate.niche_cluster_id,
    candidate_id: candidate.id,
    observed_sample_sales: metrics.observedSampleSales,
    estimated_market_sales: metrics.estimatedMarketSales,
    sample_product_family_count: metrics.familyCount,
    source_endpoint_set: asJson(['product_database']),
    captured_at: new Date().toISOString(),
    confidence: 0.7,
    metrics: asJson({ metrics, score })
  });
  await persistDecision(
    dependencies.client,
    candidate.id,
    candidate.state,
    score.verdict,
    score.reasons.map((detail) => ({ code: 'MARKET_PROBE', detail }))
  );
  await dependencies.onCheckpoint?.({ phase: 'metrics_scored', cacheKey });
  const checkpoint = { phase: 'completed' as const, cacheKey };
  await dependencies.onCheckpoint?.(checkpoint);
  return { checkpoint, realCalls };
}
