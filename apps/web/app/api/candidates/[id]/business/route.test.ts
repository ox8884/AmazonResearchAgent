import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RESEARCH_BUSINESS_SETTINGS } from '@ara/shared';
import { createAdminSession } from '../../../../../lib/server/admin-session';
import { GET, POST } from './route';

const candidateBusinessMocks = vi.hoisted(() => {
  class CandidateBusinessError extends Error {
    constructor(readonly kind: 'not_found' | 'unavailable') {
      super(kind);
      this.name = 'CandidateBusinessError';
    }
  }

  return {
    CandidateBusinessError,
    getCandidateBusiness: vi.fn(),
    appendCandidateBusiness: vi.fn()
  };
});

const {
  CandidateBusinessError,
  getCandidateBusiness,
  appendCandidateBusiness
} = candidateBusinessMocks;

vi.mock('../../../../../lib/server/admin-session-store', () => ({
  isAdminSessionActive: async () => true
}));

vi.mock('../../../../../lib/server/candidate-business', () => candidateBusinessMocks);

const sessionKey = Buffer.alloc(32, 5);
const originalSigningKey = process.env.APP_SESSION_SIGNING_KEY_B64;

function businessEvidence() {
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

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function authenticatedHeaders(csrf = true): HeadersInit {
  const issued = createAdminSession(sessionKey);
  const token = csrf ? issued.csrfToken : 'invalid-csrf-token';
  return {
    cookie: `ara_admin_session=${encodeURIComponent(issued.token)}; ara_csrf=${encodeURIComponent(issued.csrfToken)}`,
    origin: 'https://app.example.test',
    host: 'app.example.test',
    'x-csrf-token': token
  };
}

function candidateRequest(
  method: 'GET' | 'POST',
  headers: HeadersInit = {},
  body?: unknown
): Request {
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers
    }
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(
    'https://app.example.test/api/candidates/0f9b2263-5147-4f9b-8ada-63472115fe79/business',
    init
  );
}

describe('candidate business route', () => {
  beforeEach(() => {
    process.env.APP_SESSION_SIGNING_KEY_B64 = sessionKey.toString('base64');
    getCandidateBusiness.mockReset();
    appendCandidateBusiness.mockReset();
    getCandidateBusiness.mockResolvedValue({
      evidence: null,
      assessment: {
        stage: 'basic_check',
        gaps: ['business_evidence'],
        settings: { ...DEFAULT_RESEARCH_BUSINESS_SETTINGS },
        estimatedLaunchCashUsd: null,
        estimatedUnitContributionUsd: null,
        estimatedMarginPct: null,
        purchaseApproved: false
      }
    });
    appendCandidateBusiness.mockResolvedValue({
      evidence: businessEvidence(),
      assessment: {
        stage: 'basic_check',
        gaps: ['business_evidence'],
        settings: { ...DEFAULT_RESEARCH_BUSINESS_SETTINGS },
        estimatedLaunchCashUsd: null,
        estimatedUnitContributionUsd: null,
        estimatedMarginPct: null,
        purchaseApproved: false
      }
    });
  });

  afterEach(() => {
    if (originalSigningKey === undefined) delete process.env.APP_SESSION_SIGNING_KEY_B64;
    else process.env.APP_SESSION_SIGNING_KEY_B64 = originalSigningKey;
  });

  it('rejects an unauthenticated business read before loading evidence', async () => {
    const request = candidateRequest('GET');
    const response = await GET(request, routeContext('0f9b2263-5147-4f9b-8ada-63472115fe79'));
    expect(response.status).toBe(401);
    expect(getCandidateBusiness).not.toHaveBeenCalled();
  });

  it('rejects a mutation without the matching CSRF token before appending evidence', async () => {
    const request = candidateRequest('POST', authenticatedHeaders(false), businessEvidence());
    const response = await POST(request, routeContext('0f9b2263-5147-4f9b-8ada-63472115fe79'));
    expect(response.status).toBe(403);
    expect(appendCandidateBusiness).not.toHaveBeenCalled();
  });

  it('rejects an invalid candidate identifier before appending evidence', async () => {
    const request = candidateRequest('POST', authenticatedHeaders(), businessEvidence());
    const response = await POST(request, routeContext('not-a-uuid'));
    expect(response.status).toBe(400);
    expect(appendCandidateBusiness).not.toHaveBeenCalled();
  });

  it('rejects malformed or candidate-injected policy payloads before appending evidence', async () => {
    const payload = { ...businessEvidence(), minimumProfitabilityPolicy: { minimumRoiPct: 0 } };
    const response = await POST(
      candidateRequest('POST', authenticatedHeaders(), payload),
      routeContext('0f9b2263-5147-4f9b-8ada-63472115fe79')
    );
    expect(response.status).toBe(400);
    expect(appendCandidateBusiness).not.toHaveBeenCalled();
  });

  it('rejects an oversized request body before appending evidence', async () => {
    const oversized = { ...businessEvidence(), specification: { reference: 'spec-1', description: 'x'.repeat(70_000) } };
    const response = await POST(
      candidateRequest('POST', authenticatedHeaders(), oversized),
      routeContext('0f9b2263-5147-4f9b-8ada-63472115fe79')
    );
    expect(response.status).toBe(413);
    expect(appendCandidateBusiness).not.toHaveBeenCalled();
  });

  it('maps missing candidates and unavailable storage without exposing stored data', async () => {
    appendCandidateBusiness.mockRejectedValueOnce(new CandidateBusinessError('not_found'));
    getCandidateBusiness.mockRejectedValueOnce(new CandidateBusinessError('unavailable'));
    const missing = await POST(
      candidateRequest('POST', authenticatedHeaders(), businessEvidence()),
      routeContext('0f9b2263-5147-4f9b-8ada-63472115fe79')
    );
    const unavailable = await GET(
      candidateRequest('GET', authenticatedHeaders()),
      routeContext('0f9b2263-5147-4f9b-8ada-63472115fe79')
    );
    expect(missing.status).toBe(404);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({ error: 'business_unavailable' });
  });

  it('returns the persisted business projection after an authorized append', async () => {
    const payload = businessEvidence();
    const response = await POST(
      candidateRequest('POST', authenticatedHeaders(), payload),
      routeContext('0f9b2263-5147-4f9b-8ada-63472115fe79')
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      evidence: payload,
      assessment: expect.objectContaining({
        settings: DEFAULT_RESEARCH_BUSINESS_SETTINGS,
        purchaseApproved: false
      })
    });
    expect(appendCandidateBusiness).toHaveBeenCalledWith(
      '0f9b2263-5147-4f9b-8ada-63472115fe79',
      payload
    );
  });
});
