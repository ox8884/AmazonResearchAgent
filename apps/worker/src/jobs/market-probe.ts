import type { QueueDatabaseClient } from '@ara/queue';
import { notifyCandidateDecision } from './candidate-notifications';
import type { Json } from '@ara/db';
import {
  makeApiCacheKey,
  type ApiCallPurpose,
  type Locale
} from '@ara/shared';
import { authorizeApiCall, DEFAULT_CACHE_TTL_MS, type ApiBudget } from '@ara/api-budget';
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
  type CatalogProduct,
  type MarketMetrics,
  type ProductFamily
} from '@ara/research-engine';
import { executeBudgetedApiCall } from './budgeted-api-call';
import { nextBudgetResetAt } from './budget-reset';

export { nextBudgetResetAt };
export function budgetResumeIdempotencyKey(
  candidateId: string,
  purpose: ApiCallPurpose,
  availableAt: string
): string {
  return `market-probe-resume:${candidateId}:${purpose}:${availableAt.slice(0, 10)}`;
}

export function inFlightResumeIdempotencyKey(input: {
  readonly candidateId: string;
  readonly purpose: ApiCallPurpose;
  readonly cacheKey: string;
  readonly reclaimBucket: string;
  readonly reclaim: boolean;
}): string {
  const baseKey = `market-probe-inflight:${input.candidateId}:${input.purpose}:${input.cacheKey}:${input.reclaimBucket}`;
  return input.reclaim ? `${baseKey}:reclaim` : baseKey;
}

const API_CLAIM_LEASE_MS = 120_000;
const IN_FLIGHT_RECLAIM_MARGIN_MS = 1_000;
const PROVIDER_SOURCE_STALE_MS = 30 * 24 * 60 * 60 * 1000;


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

export function resumedMarketProbeCacheKey(
  primaryCacheKey: string,
  checkpoint: MarketProbeCheckpoint | undefined
): string {
  return checkpoint?.cacheKey ?? primaryCacheKey;
}

export interface MarketProbeDependencies {
  readonly client: QueueDatabaseClient;
  readonly budget: ApiBudget;
  readonly purpose?: ApiCallPurpose;
  readonly researchRunId?: string;
  readonly queryProductDatabase: (
    phrases: readonly string[]
  ) => Promise<ProductDatabaseQueryResult>;

  readonly checkpoint?: MarketProbeCheckpoint;
  enqueueResume?(input: {
    readonly candidateId: string;
    readonly locale: Locale;
    readonly purpose?: ApiCallPurpose;
    readonly researchRunId?: string;
    readonly availableAt: string;
    readonly idempotencyKey: string;
  }): Promise<void>;
  onCheckpoint?(checkpoint: MarketProbeCheckpoint): Promise<void>;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled authorization decision: ${JSON.stringify(value)}`);
}




function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

type ProviderUpdatedAtAvailability = 'complete' | 'partial' | 'unavailable';

export type MarketEvidenceAssessment =
  | {
      readonly kind: 'ready';
      readonly cacheCapturedAt: string;
      readonly providerUpdatedAt: string | null;
      readonly providerUpdatedAtAvailability: ProviderUpdatedAtAvailability;
    }
  | {
      readonly kind: 'incomplete_units' | 'unverified_cache_observation' | 'stale_provider_source';
      readonly cacheCapturedAt: string | null;
      readonly providerUpdatedAt: string | null;
      readonly providerUpdatedAtAvailability: ProviderUpdatedAtAvailability;
    };

function validTimestamp(value: string | null, nowMilliseconds: number): value is string {
  if (!value) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds <= nowMilliseconds;
}

export function assessMarketEvidence(input: {
  readonly families: readonly ProductFamily[];
  readonly cacheCapturedAt: string | null;
  readonly now: Date;
}): MarketEvidenceAssessment {
  const nowMilliseconds = input.now.getTime();
  const allVariants = input.families.flatMap((family) => family.variants);
  const providerUpdatedAtValues = allVariants
    .map((variant) => variant.updatedAt)
    .filter((value): value is string => validTimestamp(value, nowMilliseconds));
  const providerUpdatedAtAvailability: ProviderUpdatedAtAvailability =
    providerUpdatedAtValues.length === allVariants.length && allVariants.length > 0
      ? 'complete'
      : providerUpdatedAtValues.length > 0
        ? 'partial'
        : 'unavailable';
  const providerUpdatedAt = providerUpdatedAtValues.reduce<string | null>(
    (earliest, value) =>
      earliest === null || Date.parse(value) < Date.parse(earliest) ? value : earliest,
    null
  );
  const cacheCapturedAt = validTimestamp(input.cacheCapturedAt, nowMilliseconds)
    ? input.cacheCapturedAt
    : null;
  const cacheAgeMilliseconds = cacheCapturedAt
    ? nowMilliseconds - Date.parse(cacheCapturedAt)
    : Number.NaN;
  const hasCompleteSalesEvidence =
    input.families.length > 0 &&
    allVariants.length > 0 &&
    allVariants.every(
      (variant) =>
        variant.unitsSold30 !== null &&
        Number.isFinite(variant.unitsSold30) &&
        variant.unitsSold30 >= 0
    );

  if (!hasCompleteSalesEvidence) {
    return {
      kind: 'incomplete_units',
      cacheCapturedAt,
      providerUpdatedAt,
      providerUpdatedAtAvailability
    };
  }
  if (
    !cacheCapturedAt ||
    !Number.isFinite(cacheAgeMilliseconds) ||
    cacheAgeMilliseconds > DEFAULT_CACHE_TTL_MS.product_database
  ) {
    return {
      kind: 'unverified_cache_observation',
      cacheCapturedAt: null,
      providerUpdatedAt,
      providerUpdatedAtAvailability
    };
  }
  if (
    providerUpdatedAt &&
    nowMilliseconds - Date.parse(providerUpdatedAt) > PROVIDER_SOURCE_STALE_MS
  ) {
    return {
      kind: 'stale_provider_source',
      cacheCapturedAt,
      providerUpdatedAt,
      providerUpdatedAtAvailability
    };
  }
  return {
    kind: 'ready',
    cacheCapturedAt,
    providerUpdatedAt,
    providerUpdatedAtAvailability
  };
}

function snapshotMetrics(metrics: MarketMetrics, families: readonly ProductFamily[]): Json {
  const variants = families.flatMap((family) => family.variants);
  const reviewsObserved = variants.every((variant) => variant.reviews !== null);
  const brandsObserved = variants.every((variant) => variant.brand !== null);
  const sellerTypesObserved = variants.every((variant) => variant.sellerType !== null);
  return asJson({
    observedSampleSales: metrics.observedSampleSales,
    estimatedMarketSales: metrics.estimatedMarketSales,
    top3SalesConcentration: metrics.top3SalesConcentration,
    top10AverageReviews: reviewsObserved ? metrics.top10AverageReviews : null,
    medianReviews: reviewsObserved ? metrics.medianReviews : null,
    shareOver1000Reviews: reviewsObserved ? metrics.shareOver1000Reviews : null,
    brandConcentration: brandsObserved ? metrics.brandConcentration : null,
    amazonRetailPresent: sellerTypesObserved ? metrics.amazonRetailPresent : null,
    familyCount: metrics.familyCount,
    priceCompression: metrics.priceCompression,
    newerLowReviewSellerSuccess: metrics.newerLowReviewSellerSuccess,
    historicalTrendConsistency: metrics.historicalTrendConsistency
  });
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
    updatedAt: product.attributes.updated_at ?? null,
    sellerType: product.attributes.seller_type ?? null,
    listingDate: product.attributes.listing_date ?? null,
    dimensions: product.attributes.dimensions ?? null,
    sellers: product.attributes.sellers ?? null,
    buyBox: product.attributes.buy_box ?? null,
    feeBreakdown: product.attributes.fee_breakdown ?? null
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
  await notifyCandidateDecision(client, {
    candidateId,
    fromState,
    toState,
    locale: 'ko'
  });
}
async function scheduleInFlightResume(input: {
  readonly client: QueueDatabaseClient;
  readonly candidateId: string;
  readonly locale: Locale;
  readonly purpose: ApiCallPurpose;
  readonly researchRunId?: string;
  readonly cacheKey: string;
  readonly enqueueResume?: MarketProbeDependencies['enqueueResume'];
}): Promise<void> {
  const { data } = await input.client
    .from('api_call_claims')
    .select('claimed_until')
    .eq('cache_key', input.cacheKey)
    .maybeSingle();
  const claimedUntilMs = data?.claimed_until ? Date.parse(data.claimed_until) : Number.NaN;
  const reclaimMs = Number.isFinite(claimedUntilMs)
    ? claimedUntilMs + IN_FLIGHT_RECLAIM_MARGIN_MS
    : Date.now() + API_CLAIM_LEASE_MS + IN_FLIGHT_RECLAIM_MARGIN_MS;
  const availableAt = new Date(reclaimMs).toISOString();
  const reclaimBucket = Number.isFinite(claimedUntilMs)
    ? new Date(claimedUntilMs).toISOString().slice(0, 19)
    : availableAt.slice(0, 19);
  const baseKey = inFlightResumeIdempotencyKey({
    candidateId: input.candidateId,
    purpose: input.purpose,
    cacheKey: input.cacheKey,
    reclaimBucket,
    reclaim: false
  });
  const { data: existing } = await input.client
    .from('jobs')
    .select('status')
    .eq('idempotency_key', baseKey)
    .maybeSingle();
  const idempotencyKey = inFlightResumeIdempotencyKey({
    candidateId: input.candidateId,
    purpose: input.purpose,
    cacheKey: input.cacheKey,
    reclaimBucket,
    reclaim: existing?.status !== undefined && existing.status !== 'queued'
  });
  await input.enqueueResume?.({
    candidateId: input.candidateId,
    locale: input.locale,
    purpose: input.purpose,
    ...(input.researchRunId ? { researchRunId: input.researchRunId } : {}),
    availableAt,
    idempotencyKey
  });
}

async function exitUnavailableAuthorization(input: {
  readonly kind: 'deferred_budget' | 'in_flight' | 'blocked_policy';
  readonly client: QueueDatabaseClient;
  readonly candidateId: string;
  readonly fromState: string;
  readonly locale: Locale;
  readonly purpose: ApiCallPurpose;
  readonly researchRunId?: string;
  readonly cacheKey: string;
  readonly realCalls: number;
  readonly enqueueResume?: MarketProbeDependencies['enqueueResume'];
  readonly onCheckpoint?: MarketProbeDependencies['onCheckpoint'];
}): Promise<{ checkpoint: MarketProbeCheckpoint; realCalls: number }> {
  if (input.kind === 'deferred_budget') {
    await persistDecision(input.client, input.candidateId, input.fromState, 'Waiting for API Budget', [
      { code: 'API_BUDGET_EXHAUSTED', detail: 'Daily Jungle Scout reserve is preserved.' }
    ]);
    const availableAt = nextBudgetResetAt();
    await input.enqueueResume?.({
      candidateId: input.candidateId,
      locale: input.locale,
      purpose: input.purpose,
      ...(input.researchRunId ? { researchRunId: input.researchRunId } : {}),
      availableAt,
      idempotencyKey: budgetResumeIdempotencyKey(
        input.candidateId,
        input.purpose,
        availableAt
      )
    });
    const checkpoint = { phase: 'deferred_budget' as const, cacheKey: input.cacheKey };
    await input.onCheckpoint?.(checkpoint);
    return { checkpoint, realCalls: input.realCalls };
  }
  if (input.kind === 'in_flight') {
    await scheduleInFlightResume({
      client: input.client,
      candidateId: input.candidateId,
      locale: input.locale,
      purpose: input.purpose,
      ...(input.researchRunId ? { researchRunId: input.researchRunId } : {}),
      cacheKey: input.cacheKey,
      enqueueResume: input.enqueueResume
    });
    const checkpoint = { phase: 'in_flight' as const, cacheKey: input.cacheKey };
    await input.onCheckpoint?.(checkpoint);
    return { checkpoint, realCalls: input.realCalls };
  }
  const checkpoint = { phase: 'blocked_policy' as const, cacheKey: input.cacheKey };
  await input.onCheckpoint?.(checkpoint);
  return { checkpoint, realCalls: input.realCalls };
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
  let aliases: string[] = [];
  if (candidate.niche_cluster_id) {
    const { data: cluster } = await dependencies.client
      .from('niche_clusters')
      .select('catalog_phrases,canonical_name,aliases')
      .eq('id', candidate.niche_cluster_id)
      .maybeSingle();
    const catalog = cluster?.catalog_phrases;
    if (Array.isArray(catalog)) {
      phrases = catalog.filter((item): item is string => typeof item === 'string');
    }
    const clusterAliases = cluster?.aliases;
    if (Array.isArray(clusterAliases)) {
      aliases = clusterAliases.filter((item): item is string => typeof item === 'string');
    }
  }
  const cacheKey = makeApiCacheKey({
    endpoint: 'product_database',
    marketplace: 'us',
    phrases
  });
  let evidenceCacheKey = resumedMarketProbeCacheKey(cacheKey, dependencies.checkpoint);
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
      .eq('cache_key', evidenceCacheKey)
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
      case 'deferred_budget':
      case 'blocked_policy':
      case 'in_flight':
        return exitUnavailableAuthorization({
          kind: decision.kind,
          client: dependencies.client,
          candidateId: candidate.id,
          fromState: candidate.state,
          locale: input.locale,
          purpose,
          ...(dependencies.researchRunId ? { researchRunId: dependencies.researchRunId } : {}),
          cacheKey,
          realCalls: 0,
          enqueueResume: dependencies.enqueueResume,
          onCheckpoint: dependencies.onCheckpoint
        });

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

  if (page && page.data.length === 0) {
    const expanded = [...new Set([...phrases, ...aliases])].filter((phrase) => phrase.length > 0);
    if (expanded.length > phrases.length) {
      const expandedKey = makeApiCacheKey({
        endpoint: 'product_database',
        marketplace: 'us',
        phrases: expanded
      });
      const outcome = await executeBudgetedApiCall({
        client: dependencies.client,
        budget: dependencies.budget,
        candidateId: candidate.id,
        endpoint: 'product_database',
        cacheKey: expandedKey,
        purpose,
        ttlMs: DEFAULT_CACHE_TTL_MS.product_database,
        query: async () => {
          const fetched = await dependencies.queryProductDatabase(expanded);
          return {
            payload: fetched.page,
            httpAttempts: fetched.httpAttempts,
            status: fetched.status
          };
        }
      });
      switch (outcome.kind) {
        case 'completed': {
          page = ProductDatabasePageSchema.parse(outcome.payload ?? { data: [] });
          evidenceCacheKey = expandedKey;
          if (!outcome.fromCache) {
            realCalls += outcome.httpAttempts;
          }
          break;
        }
        case 'deferred_budget':
        case 'blocked_policy':
        case 'in_flight':
          return exitUnavailableAuthorization({
            kind: outcome.kind,
            client: dependencies.client,
            candidateId: candidate.id,
            fromState: candidate.state,
            locale: input.locale,
            purpose,
            ...(dependencies.researchRunId ? { researchRunId: dependencies.researchRunId } : {}),
            cacheKey: expandedKey,
            realCalls,
            enqueueResume: dependencies.enqueueResume,
            onCheckpoint: dependencies.onCheckpoint
          });
        default: {
          const exhaustive: never = outcome;
          throw new Error(`Unhandled expanded Product Database outcome: ${JSON.stringify(exhaustive)}`);
        }
      }
    }
  }
  if (page?.meta?.result_count !== undefined) {
    const { error: coverageError } = await dependencies.client.from('candidate_evidence').insert({
      candidate_id: candidate.id,
      kind: 'product_database_coverage',
      payload: asJson({ result_count: page.meta.result_count })
    });
    if (coverageError) {
      throw new Error(`Could not persist coverage evidence: ${coverageError.message}`);
    }
  }

  await dependencies.onCheckpoint?.({ phase: 'api_fetched', cacheKey: evidenceCacheKey });

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
          seller_type: variant.sellerType ?? null,
          attributes: asJson(variant)
        },
        { onConflict: 'product_family_id,asin' }
      );
      if (productError) {
        throw new Error(`Could not persist product: ${productError.message}`);
      }
    }
  }

  await dependencies.onCheckpoint?.({ phase: 'families_persisted', cacheKey: evidenceCacheKey });

  const relevant = families.filter(
    (family) => classifyProductRelevance(candidate.keyword, family).relevant
  );
  const relevantAsins = [
    ...new Set(
      relevant.flatMap((family) =>
        family.variants
          .map((variant) => variant.id)
          .filter((asin) => asin.length > 0)
      )
    )
  ].sort();
  const { error: relevantError } = await dependencies.client.from('candidate_evidence').insert({
    candidate_id: candidate.id,
    kind: 'relevant_asins',
    payload: asJson({ asins: relevantAsins, parentKeys: relevant.map((family) => family.parentKey) })
  });
  if (relevantError) {
    throw new Error(`Could not persist relevant ASINs: ${relevantError.message}`);
  }
  const clusters = clusterMicroNiches(relevant, candidate.keyword);
  await dependencies.onCheckpoint?.({ phase: 'relevance_filtered', cacheKey: evidenceCacheKey });
  const { error: evidenceError } = await dependencies.client.from('candidate_evidence').insert({
    candidate_id: candidate.id,
    kind: 'micro_niches',
    payload: asJson(
      clusters.map((cluster) => ({
        name: cluster.name,
        priceSegments: cluster.priceSegments
      }))
    )
  });

  if (evidenceError) {
    throw new Error(`Could not persist micro-niche evidence: ${evidenceError.message}`);
  }
  await dependencies.onCheckpoint?.({ phase: 'micro_niches_created', cacheKey: evidenceCacheKey });

  const { data: cacheObservation, error: cacheObservationError } = await dependencies.client
    .from('api_cache')
    .select('captured_at')
    .eq('cache_key', evidenceCacheKey)
    .maybeSingle();
  if (cacheObservationError) {
    throw new Error(`Could not read Product Database cache observation: ${cacheObservationError.message}`);
  }
  const processedAt = new Date();
  const evidence = assessMarketEvidence({
    families: relevant,
    cacheCapturedAt: cacheObservation?.captured_at ?? null,
    now: processedAt
  });
  if (evidence.kind !== 'ready') {
    const { error: statusEvidenceError } = await dependencies.client
      .from('candidate_evidence')
      .insert({
        candidate_id: candidate.id,
        kind: 'market_evidence_status',
        payload: asJson({
          status: evidence.kind,
          cacheCapturedAt: evidence.cacheCapturedAt,
          processedAt: processedAt.toISOString(),
          providerUpdatedAt: evidence.providerUpdatedAt,
          providerUpdatedAtAvailability: evidence.providerUpdatedAtAvailability
        })
      });
    if (statusEvidenceError) {
      throw new Error(`Could not persist market evidence status: ${statusEvidenceError.message}`);
    }
    await persistDecision(
      dependencies.client,
      candidate.id,
      candidate.state,
      'Needs Review',
      [{ code: `MARKET_EVIDENCE_${evidence.kind.toUpperCase()}`, detail: evidence.kind }]
    );
    await dependencies.onCheckpoint?.({ phase: 'metrics_scored', cacheKey: evidenceCacheKey });
    const checkpoint = { phase: 'completed' as const, cacheKey: evidenceCacheKey };
    await dependencies.onCheckpoint?.(checkpoint);
    return { checkpoint, realCalls };
  }
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
    captured_at: processedAt.toISOString(),
    confidence: 0.7,
    metrics: asJson({
      metrics: snapshotMetrics(metrics, relevant),
      score,
      observation: {
        cacheCapturedAt: evidence.cacheCapturedAt,
        processedAt: processedAt.toISOString(),
        providerUpdatedAt: evidence.providerUpdatedAt,
        providerUpdatedAtAvailability: evidence.providerUpdatedAtAvailability
      }
    })
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
  await dependencies.onCheckpoint?.({ phase: 'metrics_scored', cacheKey: evidenceCacheKey });
  const checkpoint = { phase: 'completed' as const, cacheKey: evidenceCacheKey };
  await dependencies.onCheckpoint?.(checkpoint);
  return { checkpoint, realCalls };
}
