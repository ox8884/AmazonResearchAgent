import { describe, expect, it } from 'vitest';
import { assessResearchBusiness } from '@ara/shared';
import { assessResearchApiAdmission } from './research-business-policy';
import { researchBusinessEvidenceFixture } from './research-business-test-support';

const settings = {
  launchBudgetUsd: 3000,
  minimumPreAdMarginPct: 35,
  minimumPostAdMarginPct: 35,
  minimumRoiPct: 150
};

describe('research business API admission', () => {
  it('blocks a candidate without persisted business evidence from initial API fanout', () => {
    const assessment = assessResearchBusiness(null, new Date('2026-09-05T00:00:00.000Z'), settings);

    const admission = assessResearchApiAdmission({
      assessment,
      evidence: null,
      requestedEndpoint: 'product_database',
      explicitInitialCheck: false
    });

    expect(admission.allowed).toBe(false);
  });

  it('blocks awaiting quote evidence even when the assessor is still at a basic stage', () => {
    const evidence = researchBusinessEvidenceFixture({
      disposition: 'awaiting_quote',
      requestedApiPurposes: ['product_database']
    });
    const assessment = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00.000Z'), settings);

    const admission = assessResearchApiAdmission({
      assessment,
      evidence,
      requestedEndpoint: 'product_database',
      explicitInitialCheck: true
    });

    expect(admission.allowed).toBe(false);
  });

  it('permits only the explicitly requested bounded initial endpoint', () => {
    const evidence = researchBusinessEvidenceFixture({
      requestedApiPurposes: ['keywords_by_keyword']
    });
    const assessment = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00.000Z'), settings);

    const requested = assessResearchApiAdmission({
      assessment,
      evidence,
      requestedEndpoint: 'keywords_by_keyword',
      explicitInitialCheck: true
    });
    const unrequested = assessResearchApiAdmission({
      assessment,
      evidence,
      requestedEndpoint: 'product_database',
      explicitInitialCheck: false
    });

    expect(requested.allowed).toBe(true);
    expect(unrequested.allowed).toBe(false);
  });

  it('blocks a known launch-budget failure before a basic-stage initial check can spend', () => {
    const evidence = researchBusinessEvidenceFixture({
      requestedApiPurposes: ['product_database']
    });
    const assessment = {
      ...assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00.000Z'), settings),
      gaps: ['launch_cash_exceeds_budget']
    };

    const admission = assessResearchApiAdmission({
      assessment,
      evidence,
      requestedEndpoint: 'product_database',
      explicitInitialCheck: true
    });

    expect(admission.allowed).toBe(false);
  });
});
