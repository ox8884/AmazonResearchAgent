import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RESEARCH_BUSINESS_SETTINGS,
  type ResearchBusinessEvidence
} from '@ara/shared';
import {
  appendCandidateBusiness,
  getCandidateBusiness
} from './candidate-business';

const candidateMaybeSingle = vi.fn();
const candidateEq = vi.fn(() => ({ maybeSingle: candidateMaybeSingle }));
const candidateSelect = vi.fn(() => ({ eq: candidateEq }));
const evidenceLimit = vi.fn();
const evidenceOrderById = vi.fn(() => ({ limit: evidenceLimit }));
const evidenceOrderByCreatedAt = vi.fn(() => ({ order: evidenceOrderById }));
const evidenceKindEq = vi.fn(() => ({ order: evidenceOrderByCreatedAt }));
const evidenceCandidateEq = vi.fn(() => ({ eq: evidenceKindEq }));
const evidenceSelect = vi.fn(() => ({ eq: evidenceCandidateEq }));
const insertedEvidenceSingle = vi.fn();
const insertedEvidenceSelect = vi.fn(() => ({ single: insertedEvidenceSingle }));
const evidenceInsert = vi.fn(() => ({ select: insertedEvidenceSelect }));
const from = vi.fn((table: string) => {
  if (table === 'candidates') return { select: candidateSelect };
  return { insert: evidenceInsert, select: evidenceSelect };
});
const readSettings = vi.fn();

vi.mock('./database', () => ({
  getServerDatabaseContext: () => ({ client: { from } })
}));

vi.mock('@ara/db', () => ({
  createResearchSettingsRepository: () => ({ read: readSettings })
}));

function businessEvidence(): ResearchBusinessEvidence {
  return {
    kind: 'research_business_v1',
    specification: { reference: 'spec-1', description: 'A qualified kitchen product.' },
    marketplace: 'US',
    brandFit: { status: 'unknown', source: null },
    disposition: 'research',
    salePrice: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    amazonUnitCosts: {
      referralFee: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
      fulfillmentFee: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
      otherVariableCost: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null }
    },
    selectedQuote: null,
    upfrontLaunchCost: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    launchAdvertisingCash: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    launchReserveCash: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    perUnitAdCost: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    perUnitReturnCost: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    marketCheck: {
      status: 'unknown',
      source: null,
      sourcePeriod: null,
      comparisonRationale: null,
      sellerEstimatedMonthlySales: null,
      sellerEstimateSource: null
    },
    sampleCheck: { status: 'unknown', source: null },
    safetyIpCheck: { status: 'unknown', source: null },
    requestedApiPurposes: []
  };
}

describe('candidate business persistence', () => {
  beforeEach(() => {
    candidateMaybeSingle.mockReset();
    evidenceLimit.mockReset();
    insertedEvidenceSingle.mockReset();
    from.mockClear();
    evidenceInsert.mockClear();
    readSettings.mockReset();
    candidateMaybeSingle.mockResolvedValue({ data: { id: '0f9b2263-5147-4f9b-8ada-63472115fe79' }, error: null });
    evidenceLimit.mockResolvedValue({ data: [], error: null });
    insertedEvidenceSingle.mockResolvedValue({
      data: { id: '4c7679c5-8b29-4b4f-8bf3-4d21b2e7ca3e', created_at: '2026-09-05T00:00:00Z' },
      error: null
    });
    readSettings.mockResolvedValue({ ...DEFAULT_RESEARCH_BUSINESS_SETTINGS });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('appends a parsed commercial revision without mutating the candidate', async () => {
    const evidence = businessEvidence();
    const result = await appendCandidateBusiness(
      '0f9b2263-5147-4f9b-8ada-63472115fe79',
      evidence
    );
    expect(evidenceInsert).toHaveBeenCalledWith({
      candidate_id: '0f9b2263-5147-4f9b-8ada-63472115fe79',
      kind: 'research_business_v1',
      payload: evidence
    });
    expect(from).not.toHaveBeenCalledWith('app_settings');
    expect(result.evidence).toEqual(evidence);
    expect(result.assessment).toMatchObject({
      stage: 'basic_check',
      settings: DEFAULT_RESEARCH_BUSINESS_SETTINGS,
      purchaseApproved: false
    });
  });

  it('fails closed when the newest stored business payload is malformed', async () => {
    evidenceLimit.mockResolvedValue({
      data: [{
        id: 'newest',
        created_at: '2026-09-05T00:00:00Z',
        payload: { kind: 'research_business_v1' }
      }],
      error: null
    });
    const result = await getCandidateBusiness('0f9b2263-5147-4f9b-8ada-63472115fe79');
    expect(result.evidence).toBeNull();
    expect(result.assessment).toMatchObject({
      stage: 'basic_check',
      gaps: ['business_evidence'],
      purchaseApproved: false
    });
  });

  it('reports a missing candidate without attempting an evidence insert', async () => {
    candidateMaybeSingle.mockResolvedValue({ data: null, error: null });
    const action = appendCandidateBusiness(
      '0f9b2263-5147-4f9b-8ada-63472115fe79',
      businessEvidence()
    );
    await expect(action).rejects.toMatchObject({ kind: 'not_found' });
    expect(evidenceInsert).not.toHaveBeenCalled();
  });
});
