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
export { groupProductFamilies } from './product-family';
export type { CatalogProduct, ProductFamily } from './product-family';
export { evaluateProductDataQuality } from './data-quality';
export type { DataQualityFlag, DataQualityResult } from './data-quality';
export { classifyProductRelevance } from './relevance';
export { clusterMicroNiches, segmentPrices } from './micro-niche';
export type { MicroNicheCluster, PriceSegment } from './micro-niche';
export { calculateMarketMetrics } from './market-metrics';
export type { MarketMetrics } from './market-metrics';
export { scoreMarketOpportunity } from './scoring/market-score';
export type { MarketScoreResult } from './scoring/market-score';
export { calculateAllowableLandedCost } from './economics';
export {
  analyzeHistoricalSearchVolume,
  analyzeSalesEstimates,
  analyzeShareOfVoice
} from './deep-evidence';
export type {
  HistoricalSearchAnalysis,
  SalesEstimatesAnalysis,
  ShareOfVoiceAnalysis
} from './deep-evidence';

export type { AllowableLandedCost } from './economics';
