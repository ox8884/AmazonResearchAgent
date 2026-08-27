import type {
  OpportunityCsvRow,
  RuleCode,
  RuleReason
} from '@ara/shared';
import {
  BRAND_OR_IP_TERMS,
  BROAD_SHOPPING_INTENT_TERMS,
  ELECTRIC_OR_BATTERY_TERMS,
  FOOD_CONTACT_TERMS,
  FRAGILE_OR_HEAVY_RISK_TERMS,
  IRRELEVANT_SUBDOMAIN_TERMS,
  SEASONAL_EVENT_TERMS
} from './lexicons';

export interface ResearchRuleConfig {
  minimumPrice: number;
  maximumPrice: number;
  allowHighSeasonality: boolean;
}

export interface RuleEvaluation {
  passed: boolean;
  reasons: RuleReason[];
  flags: string[];
}

export const DEFAULT_RULES: ResearchRuleConfig = {
  minimumPrice: 15,
  maximumPrice: 80,
  allowHighSeasonality: false
};

function normalizePhrase(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchedTerms(
  normalizedKeyword: string,
  terms: readonly string[]
): string[] {
  const paddedKeyword = ` ${normalizedKeyword} `;
  return terms.filter((term) =>
    paddedKeyword.includes(` ${normalizePhrase(term)} `)
  );
}

function addMatches(
  reasons: RuleReason[],
  code: RuleCode,
  label: string,
  matches: readonly string[]
): void {
  for (const token of matches) {
    reasons.push({
      code,
      detail: `Matched ${label} token: ${token}`
    });
  }
}

function seasonalKeywordMatches(normalizedKeyword: string): string[] {
  const matches = matchedTerms(normalizedKeyword, SEASONAL_EVENT_TERMS);
  const ordinalBirthdays = normalizedKeyword.match(
    /\b\d+(?:st|nd|rd|th) birthday\b/g
  );
  return [...new Set([...matches, ...(ordinalBirthdays ?? [])])];
}

export function evaluateOpportunityRules(
  row: OpportunityCsvRow,
  config: ResearchRuleConfig
): RuleEvaluation {
  if (config.minimumPrice > config.maximumPrice) {
    throw new RangeError('minimumPrice must not exceed maximumPrice');
  }

  const reasons: RuleReason[] = [];
  const flags = new Set<string>();
  const keyword = normalizePhrase(row.keyword);

  if (
    row.averagePrice < config.minimumPrice ||
    row.averagePrice > config.maximumPrice
  ) {
    reasons.push({
      code: 'PRICE_OUT_OF_RANGE',
      detail: `Average price $${row.averagePrice.toFixed(2)} is outside $${config.minimumPrice.toFixed(2)}-$${config.maximumPrice.toFixed(2)}`
    });
  }

  if (!config.allowHighSeasonality) {
    addMatches(
      reasons,
      'SEASONALITY_HIGH',
      'seasonal',
      seasonalKeywordMatches(keyword)
    );
    if (row.seasonality === 'High' || row.seasonality === 'Very High') {
      reasons.push({
        code: 'SEASONALITY_HIGH',
        detail: `Seasonality field is ${row.seasonality}`
      });
    }
  }

  addMatches(
    reasons,
    'ELECTRIC_OR_BATTERY',
    'electric/battery',
    matchedTerms(keyword, ELECTRIC_OR_BATTERY_TERMS)
  );
  addMatches(
    reasons,
    'IRRELEVANT_SUBDOMAIN',
    'irrelevant subdomain',
    matchedTerms(keyword, IRRELEVANT_SUBDOMAIN_TERMS)
  );
  addMatches(
    reasons,
    'BRAND_OR_IP',
    'brand/IP',
    matchedTerms(keyword, BRAND_OR_IP_TERMS)
  );
  addMatches(
    reasons,
    'BROAD_SHOPPING_INTENT',
    'broad shopping intent',
    matchedTerms(keyword, BROAD_SHOPPING_INTENT_TERMS)
  );
  addMatches(
    reasons,
    'FRAGILE_OR_HEAVY_RISK',
    'fragile/heavy risk',
    matchedTerms(keyword, FRAGILE_OR_HEAVY_RISK_TERMS)
  );

  if (matchedTerms(keyword, FOOD_CONTACT_TERMS).length > 0) {
    flags.add('FOOD_CONTACT');
  }

  return {
    passed: reasons.length === 0,
    reasons,
    flags: [...flags]
  };
}
