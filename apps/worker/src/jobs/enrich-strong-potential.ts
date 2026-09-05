import type { ApiBudget } from '@ara/api-budget';
import { DEFAULT_CACHE_TTL_MS } from '@ara/api-budget';
import type { Json } from '@ara/db';
import { makeApiCacheKey, type Locale } from '@ara/shared';
import type { QueueDatabaseClient } from '@ara/queue';
import {
  JungleScoutClientError,
  type HistoricalSearchVolumeQueryResult,
  type SalesEstimatesQueryResult,
  type ShareOfVoiceQueryResult
} from '@ara/jungle-scout';
import {
  analyzeHistoricalSearchVolume,
  analyzeSalesEstimates,
  analyzeShareOfVoice,
  scoreMarketOpportunity
} from '@ara/research-engine';
import { z } from 'zod';
import { executeBudgetedApiCall, type BudgetedCallOutcome } from './budgeted-api-call';
import { notifyCandidateDecision } from './candidate-notifications';

// allow: SIZE_OK — this module is one sequential, resumable enrichment state machine.

export interface EnrichStrongPotentialOptions {
  readonly budget?: ApiBudget;
  readonly keyword?: string;
  readonly asins?: readonly string[];
  readonly locale?: Locale;
  readonly queryHistoricalSearchVolume?: (
    keyword: string
  ) => Promise<HistoricalSearchVolumeQueryResult>;
  readonly querySalesEstimates?: (asin: string) => Promise<SalesEstimatesQueryResult>;
  readonly queryShareOfVoice?: (keyword: string) => Promise<ShareOfVoiceQueryResult>;
  enqueueResume?(input: {
    readonly candidateId: string;
    readonly locale: Locale;
    readonly availableAt: string;
    readonly idempotencyKey: string;
  }): Promise<void>;
}

export interface EnrichStrongPotentialResult {
  readonly differentiationMode: 'listing_proxy' | 'missing' | 'review_text';
  readonly completed: boolean;
  readonly analysisVerdict: 'Reject' | 'Watch' | 'Needs Review' | 'strong_potential' | null;
  readonly salesAsins: readonly string[];
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

const ScorableMarketMetricsSchema = z.object({
  observedSampleSales: z.number().finite().positive(),
  top3SalesConcentration: z.number().finite().min(0).max(1),
  familyCount: z.number().int().positive()
});

const SnapshotObservationSchema = z.object({
  cacheCapturedAt: z.string()
});

function snapshotMetricsForScoring(input: {
  readonly metrics: unknown;
  readonly now: Date;
}): z.infer<typeof ScorableMarketMetricsSchema> | null {
  const snapshot = z
    .object({
      metrics: ScorableMarketMetricsSchema,
      observation: SnapshotObservationSchema
    })
    .safeParse(input.metrics);
  if (!snapshot.success) {
    return null;
  }
  const cacheCapturedAt = Date.parse(snapshot.data.observation.cacheCapturedAt);
  if (
    !Number.isFinite(cacheCapturedAt) ||
    cacheCapturedAt > input.now.getTime() ||
    input.now.getTime() - cacheCapturedAt > DEFAULT_CACHE_TTL_MS.product_database
  ) {
    return null;
  }
  return snapshot.data.metrics;
}

function relevantAsinsFrom(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || !('asins' in payload)) {
    return [];
  }
  const asins = (payload as { asins?: unknown }).asins;
  if (!Array.isArray(asins)) {
    return [];
  }
  return [
    ...new Set(
      asins
        .filter((asin): asin is string => typeof asin === 'string' && asin.length > 0)
        .map((asin) => {
          const separator = asin.indexOf('/');
          return separator >= 0 ? asin.slice(separator + 1) : asin;
        })
        .filter((asin) => asin.length > 0)
    )
  ].sort();
}

async function persistEvidence(
  client: QueueDatabaseClient,
  candidateId: string,
  kind: string,
  payload: unknown
): Promise<void> {
  const { error } = await client.from('candidate_evidence').insert({
    candidate_id: candidateId,
    kind,
    payload: asJson(payload)
  });
  if (error) {
    throw new Error(`Could not persist ${kind} evidence: ${error.message}`);
  }
}

async function runEndpoint(input: {
  readonly client: QueueDatabaseClient;
  readonly budget: ApiBudget;
  readonly candidateId: string;
  readonly endpoint: 'historical_search_volume' | 'sales_estimates' | 'share_of_voice';
  readonly phrases: readonly string[];
  readonly query: () => Promise<{ payload: unknown; httpAttempts: number; status: number }>;
}): Promise<BudgetedCallOutcome> {
  return executeBudgetedApiCall({
    client: input.client,
    budget: input.budget,
    candidateId: input.candidateId,
    endpoint: input.endpoint,
    cacheKey: makeApiCacheKey({
      endpoint: input.endpoint,
      marketplace: 'us',
      phrases: [...input.phrases],
      version: 'v1'
    }),
    purpose: 'strong_revalidation',
    ttlMs: DEFAULT_CACHE_TTL_MS[input.endpoint],
    query: input.query
  });
}

export async function runEnrichStrongPotential(
  candidateId: string,
  client: QueueDatabaseClient,
  options: EnrichStrongPotentialOptions = {}
): Promise<EnrichStrongPotentialResult> {
  const { data: candidate, error } = await client
    .from('candidates')
    .select('id,state,keyword,niche_cluster_id')
    .eq('id', candidateId)
    .single();
  if (error || !candidate) {
    throw new Error('Enrichment candidate was not found.');
  }
  if (candidate.state !== 'Watch' && candidate.state !== 'Needs Review') {
    return {
      differentiationMode: 'missing',
      completed: false,
      analysisVerdict: null,
      salesAsins: []
    };
  }

  const keyword = options.keyword ?? candidate.keyword;
  const budget = options.budget;
  const locale = options.locale ?? 'ko';
  if (!budget || !keyword) {
    return {
      differentiationMode: 'missing',
      completed: false,
      analysisVerdict: null,
      salesAsins: []
    };
  }

  let asins = options.asins ? [...options.asins] : [];
  if (asins.length === 0) {
    const { data: relevant, error: relevantError } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', candidateId)
      .eq('kind', 'relevant_asins')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (relevantError) {
      throw new Error(`Could not load relevant ASINs: ${relevantError.message}`);
    }
    asins = relevantAsinsFrom(relevant?.payload);
  }
  asins = [...new Set(asins)].sort().slice(0, 3);

  const incomplete = async (outcome: Extract<BudgetedCallOutcome, { kind: 'deferred_budget' | 'in_flight' }>) => {
    await options.enqueueResume?.({
      candidateId,
      locale,
      availableAt: outcome.availableAt,
      idempotencyKey:
        outcome.kind === 'deferred_budget'
          ? `enrich-resume:${candidateId}:${outcome.availableAt.slice(0, 10)}`
          : `enrich-inflight:${candidateId}`
    });
    return {
      differentiationMode: 'missing' as const,
      completed: false,
      analysisVerdict: null,
      salesAsins: asins
    };
  };

  let historicalPayload: unknown;
  if (options.queryHistoricalSearchVolume) {
    const queryHistorical = options.queryHistoricalSearchVolume;
    const outcome = await runEndpoint({
      client,
      budget,
      candidateId,
      endpoint: 'historical_search_volume',
      phrases: [keyword],
      query: async () => {
        const fetched = await queryHistorical(keyword);
        return {
          payload: fetched.data,
          httpAttempts: fetched.httpAttempts,
          status: fetched.status
        };
      }
    });
    if (outcome.kind === 'blocked_policy') {
      return {
        differentiationMode: 'missing',
        completed: false,
        analysisVerdict: null,
        salesAsins: asins
      };
    }
    if (outcome.kind === 'deferred_budget' || outcome.kind === 'in_flight') {
      return incomplete(outcome);
    }
    historicalPayload = outcome.payload;
    await persistEvidence(client, candidateId, 'historical_search_volume', historicalPayload);
  }

  if (options.querySalesEstimates && asins.length > 0) {
    const querySales = options.querySalesEstimates;
    const estimates: Array<{
      asin: string;
      estimatedMonthlySales: number | null;
      dailySales?: number[];
      prices?: number[];
    }> = [];
    for (const asin of asins) {
      let outcome: BudgetedCallOutcome;
      try {
        outcome = await runEndpoint({
          client,
          budget,
          candidateId,
          endpoint: 'sales_estimates',
          phrases: [asin],
          query: async () => {
            const fetched = await querySales(asin);
            return {
              payload: fetched.data,
              httpAttempts: fetched.httpAttempts,
              status: fetched.status
            };
          }
        });
      } catch (error: unknown) {
        if (error instanceof JungleScoutClientError && error.status === 422) {
          continue;
        }
        throw error;
      }
      if (outcome.kind === 'blocked_policy') {
        return {
          differentiationMode: 'missing',
          completed: false,
          analysisVerdict: null,
          salesAsins: asins
        };
      }
      if (outcome.kind === 'deferred_budget' || outcome.kind === 'in_flight') {
        return incomplete(outcome);
      }
      if (outcome.payload && typeof outcome.payload === 'object' && 'estimates' in outcome.payload) {
        estimates.push(
          ...(outcome.payload as {
            estimates: Array<{
              asin: string;
              estimatedMonthlySales: number | null;
              dailySales?: number[];
              prices?: number[];
            }>;
          }).estimates
        );
      }
    }
    await persistEvidence(client, candidateId, 'sales_estimates', { estimates });
    await persistEvidence(
      client,
      candidateId,
      'sales_estimates_analysis',
      analyzeSalesEstimates({ estimates })
    );
  }

  if (options.queryShareOfVoice) {
    const queryShare = options.queryShareOfVoice;
    const outcome = await runEndpoint({
      client,
      budget,
      candidateId,
      endpoint: 'share_of_voice',
      phrases: [keyword],
      query: async () => {
        const fetched = await queryShare(keyword);
        return {
          payload: fetched.data,
          httpAttempts: fetched.httpAttempts,
          status: fetched.status
        };
      }
    });
    if (outcome.kind === 'blocked_policy') {
      return {
        differentiationMode: 'missing',
        completed: false,
        analysisVerdict: null,
        salesAsins: asins
      };
    }
    if (outcome.kind === 'deferred_budget' || outcome.kind === 'in_flight') {
      return incomplete(outcome);
    }
    await persistEvidence(client, candidateId, 'share_of_voice', outcome.payload);
    const brands =
      outcome.payload && typeof outcome.payload === 'object' && 'brands' in outcome.payload
        ? (outcome.payload as {
            brands: Array<{ brand: string; share: number | null }>;
          }).brands
        : [];
    await persistEvidence(
      client,
      candidateId,
      'share_of_voice_analysis',
      analyzeShareOfVoice({ brands })
    );
  }

  if (historicalPayload && typeof historicalPayload === 'object' && 'points' in historicalPayload) {
    const analysis = analyzeHistoricalSearchVolume({
      points: (historicalPayload as {
        points: Array<{
          periodStart: string;
          periodEnd: string;
          searchVolume: number | null;
        }>;
      }).points
    });
    await persistEvidence(client, candidateId, 'historical_search_volume_analysis', analysis);
  }

  await persistEvidence(client, candidateId, 'economics', {
    economicsSource: 'estimated_assumption',
    salePrice: null,
    amazonFees: null,
    differentiationEvidenceMode: 'missing',
    note: 'Allowable landed cost is not computed without observed sale price and Amazon fees.'
  });

  const { data: reviewEvidence } = await client
    .from('candidate_evidence')
    .select('id')
    .eq('candidate_id', candidateId)
    .eq('kind', 'review_text')
    .maybeSingle();
  const { data: verifiedEconomics } = await client
    .from('candidate_evidence')
    .select('payload')
    .eq('candidate_id', candidateId)
    .eq('kind', 'economics_verified')
    .maybeSingle();
  const differentiationMode = reviewEvidence ? 'review_text' : 'missing';
  const verified =
    verifiedEconomics?.payload &&
    typeof verifiedEconomics.payload === 'object' &&
    'salePrice' in verifiedEconomics.payload &&
    'amazonFees' in verifiedEconomics.payload
      ? (verifiedEconomics.payload as { salePrice: unknown; amazonFees: unknown })
      : null;
  const marginProvisional = !(
    typeof verified?.salePrice === 'number' && typeof verified.amazonFees === 'number'
  );

  const { data: snapshot } = await client
    .from('market_snapshots')
    .select('metrics')
    .eq('candidate_id', candidateId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const metrics = snapshotMetricsForScoring({
    metrics: snapshot?.metrics,
    now: new Date()
  });

  const score = scoreMarketOpportunity({
    metrics,
    hardFilterFailed: false,
    marginProvisional,
    differentiationMode,
    ipRisk: false
  });
  const analysisVerdict =
    score.verdict === 'Strong' ? 'strong_potential' : score.verdict;
  await persistEvidence(client, candidateId, 'analysis_verdict', {
    verdict: analysisVerdict,
    total: score.total,
    reasons: score.reasons,
    candidateState: score.verdict === 'Strong' ? 'Watch' : score.verdict
  });
  const toState = score.verdict === 'Strong' ? 'Watch' : score.verdict;
  if (toState !== candidate.state) {
    const { error: stateError } = await client
      .from('candidates')
      .update({ state: toState })
      .eq('id', candidateId);
    if (stateError) {
      throw new Error(`Could not persist analysis state: ${stateError.message}`);
    }
  }
  const { error: decisionError } = await client.from('decision_history').insert({
    candidate_id: candidateId,
    from_state: candidate.state,
    to_state: toState,
    reasons: asJson([{ code: 'ANALYSIS_VERDICT', detail: analysisVerdict }]),
    decided_by: 'enrich-strong-potential',
    idempotency_key: `enrich-verdict:${candidateId}:${analysisVerdict}`
  });
  if (decisionError && decisionError.code !== '23505') {
    throw new Error(`Could not persist analysis verdict: ${decisionError.message}`);
  }
  await notifyCandidateDecision(client, {
    candidateId,
    fromState: candidate.state,
    toState,
    analysisVerdict,
    locale: options.locale ?? 'ko'
  });

  return {
    differentiationMode,
    completed: true,
    analysisVerdict,
    salesAsins: asins
  };
}
