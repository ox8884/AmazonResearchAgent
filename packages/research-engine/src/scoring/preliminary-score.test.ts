import { describe, expect, it } from 'vitest';
import type { OpportunityCsvRow } from '@ara/shared';
import type { RuleEvaluation } from '../rules/opportunity-rules';
import { scorePreliminaryOpportunity } from './preliminary-score';

function makeRow(overrides: Partial<OpportunityCsvRow> = {}): OpportunityCsvRow {
  return {
    keyword: 'silicone utensil holder',
    nicheScore: 8,
    monthlyUnits: 2500,
    averagePrice: 28,
    searchVolume: { value: 1800, isUpperBound: false },
    trend30: 4,
    trend90: 8,
    competition: 'Low',
    seasonality: 'Very Low',
    lastUpdated: '2026-08-26',
    ...overrides
  };
}

function passRules(): RuleEvaluation {
  return { passed: true, reasons: [], flags: [] };
}

function rejectRules(code: RuleEvaluation['reasons'][number]['code']): RuleEvaluation {
  return {
    passed: false,
    reasons: [{ code, detail: `Rejected by ${code}` }],
    flags: []
  };
}

describe('preliminary opportunity scoring', () => {
  // Break: a rejected seasonal niche outranks or remains eligible beside an evergreen niche.
  it('ranks a low-competition evergreen target-price niche above a seasonal niche', () => {
    const good = scorePreliminaryOpportunity(
      makeRow({
        competition: 'Very Low',
        seasonality: 'Very Low',
        averagePrice: 28,
        monthlyUnits: 3000
      }),
      passRules()
    );
    const seasonal = scorePreliminaryOpportunity(
      makeRow({
        competition: 'Very Low',
        seasonality: 'Very High',
        averagePrice: 28,
        monthlyUnits: 3000
      }),
      rejectRules('SEASONALITY_HIGH')
    );

    expect(good.score).toBeGreaterThan(seasonal.score);
    expect(good.eligibleForAiNormalization).toBe(true);
    expect(seasonal.eligibleForAiNormalization).toBe(false);
  });

  // Break: component rounding does not add exactly to the persisted final score.
  it('persists components whose weighted values sum exactly to the score', () => {
    const result = scorePreliminaryOpportunity(makeRow(), passRules());
    const weightedSum = Object.values(result.components).reduce(
      (sum, component) => sum + component.weightedScore,
      0
    );

    expect(Number(weightedSum.toFixed(2))).toBe(result.score);
    expect(result.scoreType).toBe('preliminary');
  });

  // Break: normalization caps and weights cannot produce the documented 100-point ceiling.
  it('scores a fixture at the transparent 100-point ceiling', () => {
    const result = scorePreliminaryOpportunity(
      makeRow({
        nicheScore: 10,
        monthlyUnits: 3000,
        searchVolume: { value: 5000, isUpperBound: false },
        trend30: 50,
        trend90: 50,
        averagePrice: 30,
        competition: 'Very Low',
        seasonality: 'Very Low'
      }),
      passRules()
    );

    expect(result.score).toBe(100);
    expect(result.components.jsNicheScore.weightedScore).toBe(25);
    expect(result.components.competition.weightedScore).toBe(25);
    expect(result.components.demand.weightedScore).toBe(20);
  });

  // Break: '< 450' is treated as an exact 450 and receives the same demand confidence.
  it('scores an upper-bound search volume conservatively', () => {
    const exact = scorePreliminaryOpportunity(
      makeRow({ searchVolume: { value: 450, isUpperBound: false } }),
      passRules()
    );
    const upperBound = scorePreliminaryOpportunity(
      makeRow({ searchVolume: { value: 450, isUpperBound: true } }),
      passRules()
    );

    expect(upperBound.components.demand.rawScore).toBeLessThan(
      exact.components.demand.rawScore
    );
  });

  // Break: a hard-rule rejection is accidentally made eligible by a high numeric score.
  it('lets hard rules override a high numeric score', () => {
    const result = scorePreliminaryOpportunity(
      makeRow({ nicheScore: 10, competition: 'Very Low', monthlyUnits: 5000 }),
      rejectRules('BRAND_OR_IP')
    );

    expect(result.score).toBeGreaterThan(0);
    expect(result.eligibleForAiNormalization).toBe(false);
    expect(result.ruleReasons).toEqual([
      { code: 'BRAND_OR_IP', detail: 'Rejected by BRAND_OR_IP' }
    ]);
  });
});
