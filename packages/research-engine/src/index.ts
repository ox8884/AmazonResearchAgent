export {
  DEFAULT_RULES,
  evaluateOpportunityRules
} from './rules/opportunity-rules';
export type {
  ResearchRuleConfig,
  RuleEvaluation
} from './rules/opportunity-rules';
export {
  BRAND_OR_IP_TERMS,
  BROAD_SHOPPING_INTENT_TERMS,
  ELECTRIC_OR_BATTERY_TERMS,
  FOOD_CONTACT_TERMS,
  FRAGILE_OR_HEAVY_RISK_TERMS,
  IRRELEVANT_SUBDOMAIN_TERMS,
  SEASONAL_EVENT_TERMS
} from './rules/lexicons';

export { scorePreliminaryOpportunity } from './scoring/preliminary-score';
export type {
  PreliminaryComponentName,
  PreliminaryScore,
  PreliminaryScoreComponent
} from './scoring/preliminary-score';

export {
  buildNormalizationPrompt,
  KeywordNormalizationSchema,
  NORMALIZATION_PROMPT_VERSION
} from './ai/normalization-schema';
export type { KeywordNormalization } from './ai/normalization-schema';
