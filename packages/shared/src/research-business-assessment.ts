import {
  type ResearchBusinessEvidence,
  type ResearchBusinessMoney,
  type ResearchBusinessSettings,
  ResearchBusinessSettingsSchema
} from './research-business';

export type ResearchBusinessStage =
  | 'basic_check'
  | 'market_validation'
  | 'quote_ready'
  | 'awaiting_quote'
  | 'awaiting_sample'
  | 'purchase_review'
  | 'hold'
  | 'reject';

export type ResearchBusinessAssessment = {
  readonly stage: ResearchBusinessStage;
  readonly gaps: readonly string[];
  readonly settings: ResearchBusinessSettings;
  readonly estimatedLaunchCashUsd: number | null;
  readonly estimatedUnitContributionUsd: number | null;
  readonly estimatedMarginPct: number | null;
  readonly purchaseApproved: false;
};

function moneyUsd(money: ResearchBusinessMoney): number | null {
  return money.amountUsd;
}

function sumKnown(amounts: readonly (number | null)[]): number | null {
  let total = 0;
  for (const amount of amounts) {
    if (amount === null) return null;
    total += amount;
  }
  return total;
}

function result(
  stage: ResearchBusinessStage,
  gaps: readonly string[],
  settings: ResearchBusinessSettings,
  estimatedLaunchCashUsd: number | null,
  estimatedUnitContributionUsd: number | null,
  estimatedMarginPct: number | null
): ResearchBusinessAssessment {
  return { stage, gaps, settings, estimatedLaunchCashUsd, estimatedUnitContributionUsd, estimatedMarginPct, purchaseApproved: false };
}

export function assessResearchBusiness(
  evidence: ResearchBusinessEvidence | null,
  now: Date,
  settings: ResearchBusinessSettings
): ResearchBusinessAssessment {
  const parsedSettings = ResearchBusinessSettingsSchema.parse(settings);
  if (evidence === null) return result('basic_check', ['business_evidence'], parsedSettings, null, null, null);

  const gaps: string[] = [];
  const quote = evidence.selectedQuote;
  const salePrice = moneyUsd(evidence.salePrice);
  const landedUnitCost = quote === null ? null : moneyUsd(quote.landedUnitCost);
  const landedShipmentTotal = quote === null ? null : moneyUsd(quote.landedShipmentTotal);
  const amazonFees = [
    moneyUsd(evidence.amazonUnitCosts.referralFee),
    moneyUsd(evidence.amazonUnitCosts.fulfillmentFee),
    moneyUsd(evidence.amazonUnitCosts.otherVariableCost)
  ];
  const launchCosts = [
    landedUnitCost === null || quote === null ? null : quote.orderQuantity * landedUnitCost,
    moneyUsd(evidence.upfrontLaunchCost),
    moneyUsd(evidence.launchAdvertisingCash),
    moneyUsd(evidence.launchReserveCash)
  ];
  const estimatedLaunchCashUsd = sumKnown(launchCosts);
  const variableCosts = [
    landedUnitCost,
    ...amazonFees,
    moneyUsd(evidence.perUnitAdCost),
    moneyUsd(evidence.perUnitReturnCost)
  ];
  const totalVariableCosts = sumKnown(variableCosts);
  const estimatedUnitContributionUsd = salePrice !== null && totalVariableCosts !== null
    ? salePrice - totalVariableCosts
    : null;
  const estimatedMarginPct = salePrice !== null && salePrice > 0 && estimatedUnitContributionUsd !== null
    ? estimatedUnitContributionUsd / salePrice * 100
    : null;
  const perUnitAdCost = moneyUsd(evidence.perUnitAdCost);
  const preAdMarginPct = salePrice !== null && salePrice > 0 && estimatedUnitContributionUsd !== null && perUnitAdCost !== null
    ? (estimatedUnitContributionUsd + perUnitAdCost) / salePrice * 100
    : null;
  const roiPct = landedUnitCost !== null && landedUnitCost > 0 && estimatedUnitContributionUsd !== null
    ? estimatedUnitContributionUsd / landedUnitCost * 100
    : null;
  const profitabilityTargetsPass = estimatedMarginPct !== null && preAdMarginPct !== null && roiPct !== null &&
    preAdMarginPct >= parsedSettings.minimumPreAdMarginPct &&
    estimatedMarginPct >= parsedSettings.minimumPostAdMarginPct &&
    roiPct >= parsedSettings.minimumRoiPct;

  if (evidence.disposition === 'rejected') return result('reject', gaps, parsedSettings, estimatedLaunchCashUsd, estimatedUnitContributionUsd, estimatedMarginPct);
  if (evidence.brandFit.status !== 'pass') gaps.push('brand_fit');
  if (salePrice === null) gaps.push('sale_price');
  if (sumKnown(amazonFees) === null) gaps.push('amazon_unit_costs');
  if (evidence.marketCheck.status !== 'pass') gaps.push('market_check');
  if (quote === null) gaps.push('selected_quote');
  if (landedUnitCost === null) gaps.push('landed_unit_cost');
  if (estimatedLaunchCashUsd === null) gaps.push('launch_cash');
  if (estimatedLaunchCashUsd !== null && estimatedLaunchCashUsd > parsedSettings.launchBudgetUsd) gaps.push('launch_cash_exceeds_budget');
  if (estimatedUnitContributionUsd === null) gaps.push('unit_contribution');
  if (!profitabilityTargetsPass) gaps.push('profitability_targets_not_met');

  if (evidence.brandFit.status !== 'pass' || salePrice === null) {
    return result('basic_check', gaps, parsedSettings, estimatedLaunchCashUsd, estimatedUnitContributionUsd, estimatedMarginPct);
  }
  if (evidence.marketCheck.status !== 'pass') {
    return result('market_validation', gaps, parsedSettings, estimatedLaunchCashUsd, estimatedUnitContributionUsd, estimatedMarginPct);
  }
  if (quote === null || landedUnitCost === null || estimatedLaunchCashUsd === null || estimatedLaunchCashUsd > parsedSettings.launchBudgetUsd || !profitabilityTargetsPass) {
    return result('hold', gaps, parsedSettings, estimatedLaunchCashUsd, estimatedUnitContributionUsd, estimatedMarginPct);
  }
  if (evidence.disposition === 'awaiting_quote') {
    return result('awaiting_quote', gaps, parsedSettings, estimatedLaunchCashUsd, estimatedUnitContributionUsd, estimatedMarginPct);
  }
  if (quote.source.basis === 'estimate') {
    return result('quote_ready', gaps, parsedSettings, estimatedLaunchCashUsd, estimatedUnitContributionUsd, estimatedMarginPct);
  }
  if (quote.incoterm === null) gaps.push('quote_incoterm');
  if (quote.destination === null) gaps.push('quote_destination');
  if (quote.leadTimeDays === null) gaps.push('quote_lead_time');
  if (landedShipmentTotal === null) gaps.push('landed_shipment_total');
  const hasCompleteLandedCostCoverage = Object.values(quote.landedCostCoverage).every((coverage) => coverage === 'included');
  if (!hasCompleteLandedCostCoverage) gaps.push('landed_cost_coverage');
  const expiry = quote.expiresAt === null ? null : Date.parse(quote.expiresAt);
  if (expiry === null) gaps.push('quote_validity');
  if (expiry !== null && expiry <= now.getTime()) gaps.push('quote_expired');
  if (evidence.sampleCheck.status !== 'pass') gaps.push('sample_check');
  if (evidence.safetyIpCheck.status !== 'pass') gaps.push('safety_ip_check');
  if (quote.incoterm === null || quote.destination === null || quote.leadTimeDays === null || landedShipmentTotal === null || !hasCompleteLandedCostCoverage || expiry === null || expiry <= now.getTime() || evidence.safetyIpCheck.status !== 'pass') {
    return result('hold', gaps, parsedSettings, estimatedLaunchCashUsd, estimatedUnitContributionUsd, estimatedMarginPct);
  }
  if (evidence.sampleCheck.status !== 'pass' || evidence.disposition === 'awaiting_sample') {
    return result('awaiting_sample', gaps, parsedSettings, estimatedLaunchCashUsd, estimatedUnitContributionUsd, estimatedMarginPct);
  }
  return result('purchase_review', gaps, parsedSettings, estimatedLaunchCashUsd, estimatedUnitContributionUsd, estimatedMarginPct);
}
