import { describe, expect, it } from 'vitest';
import type { OpportunityCsvRow, OpportunityCsvRowInput } from '@ara/shared';
import {
  DEFAULT_RULES,
  evaluateOpportunityRules
} from './opportunity-rules';

function makeRow(overrides: Partial<OpportunityCsvRowInput> = {}): OpportunityCsvRow {
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
  } as OpportunityCsvRow;
}

describe('deterministic zero-API rules', () => {
  // Break: known unsuitable Phase 0 terms reach paid normalization or API work.
  it.each([
    ['electric can opener', 'ELECTRIC_OR_BATTERY', 'electric'],
    ['pikachu lunch box', 'BRAND_OR_IP', 'pikachu'],
    ['40th birthday decorations for women', 'SEASONALITY_HIGH', '40th birthday'],
    ['shower curtain hooks', 'IRRELEVANT_SUBDOMAIN', 'shower curtain'],
    ['kitchen essentials', 'BROAD_SHOPPING_INTENT', 'kitchen essentials']
  ] as const)('rejects %s with %s', (keyword, expectedCode, expectedToken) => {
    const result = evaluateOpportunityRules(makeRow({ keyword }), DEFAULT_RULES);

    expect(result.reasons.map((reason) => reason.code)).toContain(expectedCode);
    expect(
      result.reasons
        .filter((reason) => reason.code === expectedCode)
        .some((reason) => reason.detail.includes(expectedToken))
    ).toBe(true);
  });

  // Break: an approved, non-electric Kitchen & Dining niche is over-filtered.
  it('does not reject pancake dispenser bottle', () => {
    const result = evaluateOpportunityRules(
      makeRow({ keyword: 'pancake dispenser bottle' }),
      DEFAULT_RULES
    );

    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.flags).toContain('FOOD_CONTACT');
  });

  // Break: target retail bounds do not override an otherwise strong CSV row.
  it.each([
    [14.99, 'PRICE_OUT_OF_RANGE'],
    [80.01, 'PRICE_OUT_OF_RANGE']
  ] as const)('rejects price %s outside the target range', (averagePrice, code) => {
    const result = evaluateOpportunityRules(makeRow({ averagePrice }), DEFAULT_RULES);
    expect(result.reasons.map((reason) => reason.code)).toContain(code);
  });

  // Break: a configured seasonality exception is ignored.
  it('allows high seasonality only when explicitly configured', () => {
    const row = makeRow({ keyword: 'christmas cookie tin', seasonality: 'Very High' });

    expect(evaluateOpportunityRules(row, DEFAULT_RULES).passed).toBe(false);
    expect(
      evaluateOpportunityRules(row, {
        ...DEFAULT_RULES,
        allowHighSeasonality: true
      }).passed
    ).toBe(true);
  });

  // Break: risk reasons are boolean-only and omit the token that caused rejection.
  it('records every matched auditable reason', () => {
    const result = evaluateOpportunityRules(
      makeRow({ keyword: 'electric pikachu glass lunch box' }),
      DEFAULT_RULES
    );

    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ELECTRIC_OR_BATTERY' }),
        expect.objectContaining({ code: 'BRAND_OR_IP' }),
        expect.objectContaining({ code: 'FRAGILE_OR_HEAVY_RISK' })
      ])
    );
    expect(result.reasons.every((reason) => reason.detail.length > 0)).toBe(true);
  });
});
