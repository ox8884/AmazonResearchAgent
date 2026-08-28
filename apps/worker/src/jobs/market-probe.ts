import type { QueueDatabaseClient } from '@ara/queue';
import type { Json } from '@ara/db';
import {
  makeApiCacheKey,
  type ApiCallPurpose,
  type Locale
} from '@ara/shared';
import { authorizeApiCall, type ApiBudget } from '@ara/api-budget';
import {
  JungleScoutClientError,
  ProductDatabasePageSchema,
  type ProductDatabasePage,
  type ProductDatabaseQueryResult
} from '@ara/jungle-scout';

import {
  calculateMarketMetrics,
  classifyProductRelevance,
  clusterMicroNiches,
  evaluateProductDataQuality,
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
  | 'deferred_budget'
  | 'in_flight'
  | 'blocked_policy';


export interface MarketProbeCheckpoint {
  readonly phase: MarketProbePhase;
  readonly cacheKey?: string;
}

export interface MarketProbeDependencies {
  readonly client: QueueDatabaseClient;
  readonly budget: ApiBudget;
  readonly purpose?: ApiCallPurpose;
  readonly queryProductDatabase: (
    phrases: readonly string[]
  ) => Promise<ProductDatabaseQueryResult>;

  readonly checkpoint?: MarketProbeCheckpoint;
  enqueueResume?(input: {
    readonly candidateId: string;
    readonly locale: Locale;
    readonly availableAt: string;
    readonly idempotencyKey: string;
  }): Promise<void>;
  onCheckpoint?(checkpoint: MarketProbeCheckpoint): Promise<void>;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled authorization decision: ${JSON.stringify(value)}`);
}

export function nextBudgetResetAt(now = new Date()): string {
  const zone = 'America/Chicago';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now);
  const start = now.getTime();
  const limit = start + 50 * 60 * 60 * 1000;
  for (let ms = start; ms <= limit; ms += 60 * 1000) {
    const instant = new Date(ms);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(instant);
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour: '2-digit',
        hourCycle: 'h23'
      }).format(instant)
    );
    const minute = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: zone, minute: '2-digit' }).format(instant)
    );
    if (date !== today && hour === 0 && minute === 0) {
      return instant.toISOString();
    }
  }
  throw new Error('Could not resolve next America/Chicago budget reset.');
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
  const priorPhase = dependencies.checkpoint?.phase;
  const canReuseFetchedPage =
    priorPhase === 'api_fetched' ||
    priorPhase === 'families_persisted' ||
    priorPhase === 'relevance_filtered' ||
    priorPhase === 'micro_niches_created' ||
    priorPhase === 'metrics_scored' ||
    priorPhase === 'completed';

  let page: ProductDatabasePage | undefined;
  let realCalls = 0;
  if (canReuseFetchedPage) {
    const { data: cached } = await dependencies.client
      .from('api_cache')
      .select('response')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (cached?.response) {
      page = ProductDatabasePageSchema.parse(cached.response);
    }
  }

  if (!page) {
    const decision = await authorizeApiCall(dependencies.budget, {
      purpose,
      estimatedCalls: 1,
      cacheKey,
      endpoint: 'product_database'
    });
    switch (decision.kind) {
      case 'deferred_budget': {
        await persistDecision(
          dependencies.client,
          candidate.id,
          candidate.state,
          'Waiting for API Budget',
          [{ code: 'API_BUDGET_EXHAUSTED', detail: 'Daily Jungle Scout reserve is preserved.' }]
        );
        const availableAt = nextBudgetResetAt();
        await dependencies.enqueueResume?.({
          candidateId: candidate.id,
          locale: input.locale,
          availableAt,
          idempotencyKey: `market-probe-resume:${candidate.id}:${availableAt.slice(0, 10)}`
        });
        const checkpoint = { phase: 'deferred_budget' as const, cacheKey };
        await dependencies.onCheckpoint?.(checkpoint);
        return { checkpoint, realCalls: 0 };
      }
      case 'blocked_policy': {
        const checkpoint = { phase: 'blocked_policy' as const, cacheKey };
        await dependencies.onCheckpoint?.(checkpoint);
        return { checkpoint, realCalls: 0 };
      }
      case 'in_flight': {
        const availableAt = new Date(Date.now() + 15_000).toISOString();
        await dependencies.enqueueResume?.({
          candidateId: candidate.id,
          locale: input.locale,
          availableAt,
          idempotencyKey: `market-probe-inflight:${candidate.id}:${cacheKey}`
        });
        const checkpoint = { phase: 'in_flight' as const, cacheKey };
        await dependencies.onCheckpoint?.(checkpoint);
        return { checkpoint, realCalls: 0 };
      }

      case 'cache_hit': {
        await dependencies.onCheckpoint?.({ phase: 'budget_authorized', cacheKey });
        const { data: cached } = await dependencies.client
          .from('api_cache')
          .select('response')
          .eq('cache_key', cacheKey)
          .maybeSingle();
        page = ProductDatabasePageSchema.parse(cached?.response ?? { data: [] });
        break;
      }
      case 'allowed': {
        await dependencies.onCheckpoint?.({ phase: 'budget_authorized', cacheKey });
        try {
          const staged = await dependencies.budget.readStaged?.(cacheKey);
          let status = 200;
          let attempts = 0;
          if (staged && typeof staged === 'object' && 'page' in staged) {
            const stagedPage = staged.page;
            page = ProductDatabasePageSchema.parse(stagedPage);
            status =
              'status' in staged && typeof staged.status === 'number' ? staged.status : 200;
            attempts =
              'httpAttempts' in staged && typeof staged.httpAttempts === 'number'
                ? staged.httpAttempts
                : 0;
            realCalls = 0;
          } else {
            const fetched = await dependencies.queryProductDatabase(phrases);
            page = fetched.page;
            status = fetched.status;
            attempts = fetched.httpAttempts;
            realCalls = fetched.httpAttempts;
            await dependencies.budget.stage?.(cacheKey, {
              page: fetched.page,
              status: fetched.status,
              httpAttempts: fetched.httpAttempts
            });
          }
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
            http_status: status,
            call_count: attempts,
            retry_count: Math.max(0, attempts - 1),
            cached: realCalls === 0,
            success: true,
            candidate_id: candidate.id,
            niche_cluster_id: candidate.niche_cluster_id,
            budget_date: new Date().toISOString().slice(0, 10)
          });
          if (usageError) {
            throw new Error(`Could not persist API usage: ${usageError.message}`);
          }
          await dependencies.budget.complete?.(cacheKey);
        } catch (error: unknown) {
          if (error instanceof JungleScoutClientError) {
            const { error: usageError } = await dependencies.client.from('api_usage').insert({
              endpoint: 'product_database',
              cache_key: cacheKey,
              purpose,
              http_status: error.status ?? 0,
              call_count: error.httpAttempts,
              retry_count: Math.max(0, error.httpAttempts - 1),
              cached: false,
              success: false,
              candidate_id: candidate.id,
              niche_cluster_id: candidate.niche_cluster_id,
              budget_date: new Date().toISOString().slice(0, 10)
            });
            if (usageError) {
              throw new Error(`Could not persist API usage: ${usageError.message}`, {
                cause: error
              });
            }
          }
          throw error;
        }
        break;
      }
      default:
        return assertNever(decision);
    }
  }

  await dependencies.onCheckpoint?.({ phase: 'api_fetched', cacheKey });

  const families = groupProductFamilies(toCatalog(page));
  for (const family of families) {
    const quality = evaluateProductDataQuality({
      price: family.variants[0]?.price ?? null,
      units: family.observedMonthlyUnits,
      revenue: family.observedMonthlyRevenue,
      reviews: family.variants[0]?.reviews ?? null,
      rating: family.variants[0]?.rating ?? null,
      weight: family.variants[0]?.weight ?? null,
      updatedAt: family.variants[0]?.updatedAt ?? null,
      variantSalesDuplicated: family.qualityNotes.includes('VARIANT_SALES_DUPLICATED')
    });
    const { data: familyRow, error: familyError } = await dependencies.client
      .from('product_families')
      .upsert(
        {
          niche_cluster_id: candidate.niche_cluster_id,
          parent_key: family.parentKey,
          observed_monthly_units: family.observedMonthlyUnits,
          observed_monthly_revenue: family.observedMonthlyRevenue,
          variant_count: family.variants.length,
          quality_notes: asJson([...family.qualityNotes, ...quality.flags])
        },
        { onConflict: 'niche_cluster_id,parent_key' }
      )
      .select('id')
      .single();
    if (familyError || !familyRow) {
      throw new Error('Could not persist product family.');
    }
    for (const variant of family.variants) {
      const { error: productError } = await dependencies.client.from('products').upsert(
        {
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
        },
        { onConflict: 'product_family_id,asin' }
      );
      if (productError) {
        throw new Error(`Could not persist product: ${productError.message}`);
      }
    }
  }

  await dependencies.onCheckpoint?.({ phase: 'families_persisted', cacheKey });

  const relevant = families.filter(
    (family) => classifyProductRelevance(candidate.keyword, family).relevant
  );
  const clusters = clusterMicroNiches(relevant, candidate.keyword);
  await dependencies.onCheckpoint?.({ phase: 'relevance_filtered', cacheKey });
  const { error: evidenceError } = await dependencies.client.from('candidate_evidence').insert({
    candidate_id: candidate.id,
    kind: 'micro_niches',
    payload: asJson(clusters.map((cluster) => cluster.name))
  });
  if (evidenceError) {
    throw new Error(`Could not persist micro-niche evidence: ${evidenceError.message}`);
  }
  await dependencies.onCheckpoint?.({ phase: 'micro_niches_created', cacheKey });

  const metrics = calculateMarketMetrics(relevant);
  const score = scoreMarketOpportunity({
    metrics,
    hardFilterFailed: false,
    marginProvisional: true,
    differentiationMode: 'missing',
    ipRisk: false
  });
  const { error: snapshotError } = await dependencies.client.from('market_snapshots').insert({
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
  if (snapshotError) {
    throw new Error(`Could not persist market snapshot: ${snapshotError.message}`);
  }
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
