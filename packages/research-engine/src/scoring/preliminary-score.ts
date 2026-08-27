import type {
  OpportunityCsvRow,
  RuleReason
} from '@ara/shared';
import type { RuleEvaluation } from '../rules/opportunity-rules';

export type PreliminaryComponentName =
  | 'jsNicheScore'
  | 'competition'
  | 'demand'
  | 'trend'
  | 'priceFit'
  | 'seasonality';

export interface PreliminaryScoreComponent {
  rawScore: number;
  weight: number;
  weightedScore: number;
}

export interface PreliminaryScore {
  scoreType: 'preliminary';
  score: number;
  components: Record<PreliminaryComponentName, PreliminaryScoreComponent>;
  eligibleForAiNormalization: boolean;
  ruleReasons: RuleReason[];
  riskFlags: string[];
}

const WEIGHTS: Record<PreliminaryComponentName, number> = {
  jsNicheScore: 0.25,
  competition: 0.25,
  demand: 0.2,
  trend: 0.1,
  priceFit: 0.1,
  seasonality: 0.1
};

const COMPETITION_SCORE: Record<OpportunityCsvRow['competition'], number> = {
  'Very Low': 100,
  Low: 80,
  Medium: 55,
  High: 25,
  'Very High': 0
};

const SEASONALITY_SCORE: Record<OpportunityCsvRow['seasonality'], number> = {
  'Very Low': 100,
  Low: 80,
  Medium: 55,
  High: 20,
  'Very High': 0
};

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function priceFitScore(price: number): number {
  if (price < 15 || price > 80) {
    return 0;
  }
  if (price < 25) {
    return 60 + ((price - 15) / 10) * 40;
  }
  if (price <= 50) {
    return 100;
  }
  return 100 - ((price - 50) / 30) * 40;
}

function demandScore(row: OpportunityCsvRow): number {
  const units = clamp((row.monthlyUnits / 3000) * 100);
  const boundedSearchVolume =
    row.searchVolume.value * (row.searchVolume.isUpperBound ? 0.75 : 1);
  const search = clamp((boundedSearchVolume / 5000) * 100);
  return (units + search) / 2;
}

function trendScore(row: OpportunityCsvRow): number {
  return clamp(50 + (row.trend30 + row.trend90) / 2);
}

function component(
  name: PreliminaryComponentName,
  rawScore: number
): PreliminaryScoreComponent {
  const normalized = roundTwo(clamp(rawScore));
  return {
    rawScore: normalized,
    weight: WEIGHTS[name],
    weightedScore: roundTwo(normalized * WEIGHTS[name])
  };
}

export function scorePreliminaryOpportunity(
  row: OpportunityCsvRow,
  ruleEvaluation: RuleEvaluation
): PreliminaryScore {
  const components: PreliminaryScore['components'] = {
    jsNicheScore: component('jsNicheScore', row.nicheScore * 10),
    competition: component(
      'competition',
      COMPETITION_SCORE[row.competition]
    ),
    demand: component('demand', demandScore(row)),
    trend: component('trend', trendScore(row)),
    priceFit: component('priceFit', priceFitScore(row.averagePrice)),
    seasonality: component(
      'seasonality',
      SEASONALITY_SCORE[row.seasonality]
    )
  };
  const score = roundTwo(
    Object.values(components).reduce(
      (sum, scoreComponent) => sum + scoreComponent.weightedScore,
      0
    )
  );

  return {
    scoreType: 'preliminary',
    score,
    components,
    eligibleForAiNormalization: ruleEvaluation.passed,
    ruleReasons: [...ruleEvaluation.reasons],
    riskFlags: [...ruleEvaluation.flags]
  };
}
