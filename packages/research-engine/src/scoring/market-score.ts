import type { MarketMetrics } from '../market-metrics';

export type ScorableMarketMetrics = Pick<
  MarketMetrics,
  'observedSampleSales' | 'top3SalesConcentration' | 'familyCount'
>;

export interface MarketScoreResult {
  readonly total: number;
  readonly components: {
    readonly competition: number;
    readonly demand: number;
    readonly margin: number;
    readonly differentiation: number;
  };
  readonly verdict: 'Reject' | 'Watch' | 'Needs Review' | 'Strong';
  readonly reasons: readonly string[];
  readonly hardFilterFailed: boolean;
}

export interface MarketScoreInput {
  readonly metrics: ScorableMarketMetrics | null;
  readonly hardFilterFailed: boolean;
  readonly hardFilterReason?: string;
  readonly marginProvisional: boolean;
  readonly differentiationMode: 'review_text' | 'listing_proxy' | 'missing';
  readonly ipRisk: boolean;
}

export function scoreMarketOpportunity(input: MarketScoreInput): MarketScoreResult {
  const reasons: string[] = [];
  if (input.hardFilterFailed) {
    return {
      total: 0,
      components: { competition: 0, demand: 0, margin: 0, differentiation: 0 },
      verdict: 'Reject',
      reasons: [input.hardFilterReason ?? 'Hard filter failed'],
      hardFilterFailed: true
    };
  }
  if (input.ipRisk) {
    return {
      total: 0,
      components: { competition: 0, demand: 0, margin: 0, differentiation: 0 },
      verdict: 'Reject',
      reasons: ['High IP risk blocks Strong and Watch promotion'],
      hardFilterFailed: true
    };
  }

  if (
    !input.metrics ||
    !Number.isInteger(input.metrics.familyCount) ||
    input.metrics.familyCount < 1 ||
    !Number.isFinite(input.metrics.observedSampleSales) ||
    input.metrics.observedSampleSales <= 0 ||
    !Number.isFinite(input.metrics.top3SalesConcentration) ||
    input.metrics.top3SalesConcentration < 0 ||
    input.metrics.top3SalesConcentration > 1
  ) {
    return {
      total: 0,
      components: { competition: 0, demand: 0, margin: 0, differentiation: 0 },
      verdict: 'Needs Review',
      reasons: ['MARKET_EVIDENCE_UNVERIFIED'],
      hardFilterFailed: false
    };
  }

  const competition = Math.round(
    40 * (1 - Math.min(1, input.metrics.top3SalesConcentration))
  );
  const demand = Math.min(
    30,
    Math.round((input.metrics.observedSampleSales / 2000) * 30)
  );
  const margin = input.marginProvisional ? 10 : 20;
  const differentiation =
    input.differentiationMode === 'review_text'
      ? 10
      : input.differentiationMode === 'listing_proxy'
        ? 5
        : 0;
  if (input.marginProvisional) {
    reasons.push('Margin is provisional without supplier-verified landed cost');
  }
  if (input.differentiationMode !== 'review_text') {
    reasons.push(`Differentiation evidence mode is ${input.differentiationMode}`);
  }

  const total = competition + demand + margin + differentiation;
  let verdict: MarketScoreResult['verdict'] = 'Watch';
  if (
    total >= 70 &&
    !input.marginProvisional &&
    input.differentiationMode === 'review_text' &&
    input.metrics.observedSampleSales >= 300
  ) {
    verdict = 'Strong';
  } else if (input.marginProvisional || input.differentiationMode === 'missing') {
    verdict = 'Needs Review';
  }

  return {
    total,
    components: { competition, demand, margin, differentiation },
    verdict,
    reasons,
    hardFilterFailed: false
  };
}
