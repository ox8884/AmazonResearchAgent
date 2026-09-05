import { createResearchSettingsRepository } from '@ara/db';
import {
  assessResearchBusiness,
  selectLatestResearchBusiness,
  type JungleScoutEndpoint,
  type ResearchBusinessAssessment,
  type ResearchBusinessEvidence
} from '@ara/shared';
import type { QueueDatabaseClient } from '@ara/queue';

export type ResearchApiAdmission = {
  readonly allowed: boolean;
  readonly reason: string;
};

export type ResearchBusinessAdmissionContext = {
  readonly evidence: ResearchBusinessEvidence | null;
  readonly evidenceId: string | null;
  readonly assessment: ResearchBusinessAssessment;
};

export class ResearchBusinessAdmissionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ResearchBusinessAdmissionError';
  }
}

function hasKnownAmount(input: { readonly amountUsd: number | null }): boolean {
  return input.amountUsd !== null;
}

function hasKnownProfitabilityFailure(input: {
  readonly assessment: ResearchBusinessAssessment;
  readonly evidence: ResearchBusinessEvidence;
}): boolean {
  if (!input.assessment.gaps.includes('profitability_targets_not_met')) {
    return false;
  }
  const quote = input.evidence.selectedQuote;
  if (quote === null) {
    return false;
  }
  return [
    input.evidence.salePrice,
    quote.landedUnitCost,
    input.evidence.amazonUnitCosts.referralFee,
    input.evidence.amazonUnitCosts.fulfillmentFee,
    input.evidence.amazonUnitCosts.otherVariableCost,
    input.evidence.perUnitAdCost,
    input.evidence.perUnitReturnCost
  ].every(hasKnownAmount);
}

export function isExplicitInitialCheck(
  evidence: ResearchBusinessEvidence | null,
  endpoint: JungleScoutEndpoint
): boolean {
  return evidence?.requestedApiPurposes.includes(endpoint) ?? false;
}

export function researchBusinessAdmissionIdempotencySuffix(
  context: ResearchBusinessAdmissionContext
): string | null {
  if (context.evidenceId === null) {
    return null;
  }
  const settings = context.assessment.settings;
  return [
    context.evidenceId,
    settings.launchBudgetUsd,
    settings.minimumPreAdMarginPct,
    settings.minimumPostAdMarginPct,
    settings.minimumRoiPct
  ].join(':');
}

export function assessResearchApiAdmission(input: {
  readonly assessment: ResearchBusinessAssessment;
  readonly evidence: ResearchBusinessEvidence | null;
  readonly requestedEndpoint: JungleScoutEndpoint;
  readonly explicitInitialCheck: boolean;
}): ResearchApiAdmission {
  const evidence = input.evidence;
  if (evidence === null) {
    return { allowed: false, reason: 'business_evidence_required' };
  }
  if (!input.explicitInitialCheck || !isExplicitInitialCheck(evidence, input.requestedEndpoint)) {
    return { allowed: false, reason: 'explicit_endpoint_request_required' };
  }
  if (evidence.disposition === 'rejected') {
    return { allowed: false, reason: 'candidate_rejected' };
  }
  if (evidence.disposition === 'awaiting_quote' || evidence.disposition === 'awaiting_sample') {
    return { allowed: false, reason: 'commercial_wait_in_progress' };
  }
  if (input.assessment.gaps.includes('launch_cash_exceeds_budget')) {
    return { allowed: false, reason: 'launch_budget_exceeded' };
  }
  if (hasKnownProfitabilityFailure({ assessment: input.assessment, evidence })) {
    return { allowed: false, reason: 'profitability_targets_not_met' };
  }
  switch (input.assessment.stage) {
    case 'basic_check':
    case 'market_validation':
      return { allowed: true, reason: 'explicit_initial_check' };
    case 'quote_ready':
    case 'awaiting_quote':
    case 'awaiting_sample':
    case 'purchase_review':
    case 'hold':
    case 'reject':
      return { allowed: false, reason: 'assessment_not_actionable' };
    default: {
      const exhaustive: never = input.assessment.stage;
      throw new ResearchBusinessAdmissionError(`Unhandled research business stage: ${exhaustive}`);
    }
  }
}

export async function loadResearchBusinessAdmissionContext(
  client: QueueDatabaseClient,
  candidateId: string,
  now = new Date()
): Promise<ResearchBusinessAdmissionContext> {
  const settings = await createResearchSettingsRepository(client).read();
  const { data, error } = await client
    .from('candidate_evidence')
    .select('id,created_at,payload')
    .eq('candidate_id', candidateId)
    .eq('kind', 'research_business_v1')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) {
    throw new ResearchBusinessAdmissionError('Could not load latest research business evidence.', error);
  }
  const evidence = selectLatestResearchBusiness(data ?? []);
  const latestRow = data?.[0];
  return {
    evidence,
    evidenceId: evidence === null ? null : latestRow?.id ?? null,
    assessment: assessResearchBusiness(evidence, now, settings)
  };
}
