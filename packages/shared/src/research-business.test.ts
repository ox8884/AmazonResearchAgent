import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESEARCH_BUSINESS_SETTINGS,
  ResearchBusinessEvidenceSchema,
  ResearchBusinessSettingsSchema,
  selectLatestResearchBusiness
} from './research-business';
import { assessResearchBusiness } from './research-business-assessment';

const source = (
  reference: string,
  basis: 'estimate' | 'quote' | 'observed' = 'observed'
) => ({
  reference,
  url: null,
  recordedAt: '2026-09-01T00:00:00Z',
  basis
});

const quotedUsd = (amount: number, reference: string, basis: 'estimate' | 'quote' | 'observed' = 'quote') => ({
  amount,
  currency: 'USD',
  amountUsd: amount,
  source: source(reference, basis),
  usdConversionSource: null
});

const unknownMoney = () => ({
  amount: null,
  currency: null,
  amountUsd: null,
  source: null,
  usdConversionSource: null
});

const settingsFixture = () => ({ ...DEFAULT_RESEARCH_BUSINESS_SETTINGS });

function evidenceFixture() {
  return {
    kind: 'research_business_v1',
    specification: {
      reference: 'forge-kitchen-spec-01',
      description: 'Stainless steel pancake batter dispenser with branded packaging.'
    },
    marketplace: 'US',
    brandFit: { status: 'pass', source: source('forge-kitchen-brand-fit') },
    disposition: 'research',
    salePrice: quotedUsd(40, 'amazon-comparable-price', 'observed'),
    amazonUnitCosts: {
      referralFee: quotedUsd(6, 'amazon-fee-estimate', 'estimate'),
      fulfillmentFee: quotedUsd(4, 'amazon-fba-estimate', 'estimate'),
      otherVariableCost: quotedUsd(0, 'amazon-other-costs', 'estimate')
    },
    selectedQuote: {
      source: source('supplier-quote-01', 'quote'),
      supplierName: 'Example Supplier',
      specificationReference: 'forge-kitchen-spec-01',
      orderQuantity: 100,
      minimumOrderQuantity: 50,
      landedUnitCost: quotedUsd(10, 'supplier-quote-01'),
      landedShipmentTotal: quotedUsd(1000, 'supplier-quote-01'),
      expiresAt: '2026-09-10T00:00:00Z',
      incoterm: 'DDP',
      destination: 'US warehouse',
      leadTimeDays: 30,
      landedCostCoverage: {
        product: 'included',
        packaging: 'included',
        freight: 'included',
        duties: 'included',
        delivery: 'included'
      }
    },
    upfrontLaunchCost: quotedUsd(100, 'launch-cost-plan', 'estimate'),
    launchAdvertisingCash: quotedUsd(500, 'launch-ad-plan', 'estimate'),
    launchReserveCash: quotedUsd(1400, 'launch-reserve-plan', 'estimate'),
    perUnitAdCost: quotedUsd(2, 'per-unit-ad-plan', 'estimate'),
    perUnitReturnCost: quotedUsd(1, 'per-unit-return-plan', 'estimate'),
    marketCheck: {
      status: 'pass',
      source: source('market-validation', 'estimate'),
      sourcePeriod: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
      comparisonRationale: 'Comparable US marketplace listings match the selected specification.',
      sellerEstimatedMonthlySales: 120,
      sellerEstimateSource: source('seller-estimate', 'estimate')
    },
    sampleCheck: { status: 'pass', source: source('sample-inspection') },
    safetyIpCheck: { status: 'pass', source: source('safety-ip-review') },
    requestedApiPurposes: []
  };
}

describe('research business evidence', () => {
  it('does not authorize a purchase from missing commercial evidence', () => {
    // Given: no versioned commercial evidence exists.
    const evidence = null;

    // When: the business assessment is requested.
    const result = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00Z'), settingsFixture());

    // Then: the product remains at basic investigation with no invented cash total.
    expect(result).toMatchObject({
      stage: 'basic_check',
      estimatedLaunchCashUsd: null,
      purchaseApproved: false
    });
  });

  it('allows a quote-less candidate to remain in bounded market validation', () => {
    // Given: a US candidate has a sourced sale price but no selected supply quote or market conclusion.
    const evidence = ResearchBusinessEvidenceSchema.parse({
      ...evidenceFixture(),
      selectedQuote: null,
      marketCheck: {
        status: 'unknown',
        source: null,
        sourcePeriod: null,
        comparisonRationale: null,
        sellerEstimatedMonthlySales: null,
        sellerEstimateSource: null
      }
    });

    // When: its business stage is derived.
    const result = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00Z'), settingsFixture());

    // Then: bounded market validation remains possible without inventing a quote.
    expect(result).toMatchObject({ stage: 'market_validation', purchaseApproved: false });
    expect(result.gaps).toContain('selected_quote');
  });

  it('uses only the current administrator settings to re-evaluate commercial eligibility', () => {
    // Given: one $4000 plan whose non-budget commercial checks pass.
    const evidence = ResearchBusinessEvidenceSchema.parse({
      ...evidenceFixture(),
      launchReserveCash: quotedUsd(2400, 'launch-reserve-plan', 'estimate')
    });

    // When: the same evidence is assessed under changed budget and profitability settings.
    const defaultBudget = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00Z'), settingsFixture());
    const raisedBudgetSettings = { ...settingsFixture(), launchBudgetUsd: 5000 };
    const raisedBudget = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00Z'), raisedBudgetSettings);
    const loweredBudget = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00Z'), { ...settingsFixture(), launchBudgetUsd: 3500 });
    const stricterPreAdMargin = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00Z'), { ...raisedBudgetSettings, minimumPreAdMarginPct: 48 });
    const stricterPostAdMargin = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00Z'), { ...raisedBudgetSettings, minimumPostAdMarginPct: 43 });
    const stricterRoi = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00Z'), { ...raisedBudgetSettings, minimumRoiPct: 171 });

    // Then: only trusted current settings change the same evidence's eligibility.
    expect(defaultBudget).toMatchObject({ stage: 'hold', settings: settingsFixture() });
    expect(raisedBudget).toMatchObject({ stage: 'purchase_review', settings: raisedBudgetSettings });
    expect(loweredBudget).toMatchObject({ stage: 'hold', settings: { ...settingsFixture(), launchBudgetUsd: 3500 } });
    expect(stricterPreAdMargin.stage).toBe('hold');
    expect(stricterPostAdMargin.stage).toBe('hold');
    expect(stricterRoi.stage).toBe('hold');
  });

  it('fails closed for missing or invalid administrator settings', () => {
    // Given: missing, incomplete, negative, and non-finite settings values.
    const missing = ResearchBusinessSettingsSchema.safeParse(undefined);
    const incomplete = ResearchBusinessSettingsSchema.safeParse({ launchBudgetUsd: 3000, minimumPreAdMarginPct: 35, minimumPostAdMarginPct: 35 });
    const injected = ResearchBusinessSettingsSchema.safeParse({ ...settingsFixture(), candidateMinimumRoiPct: 0 });
    const negative = ResearchBusinessSettingsSchema.safeParse({ ...settingsFixture(), launchBudgetUsd: -1 });
    const nonFinite = ResearchBusinessSettingsSchema.safeParse({ ...settingsFixture(), minimumRoiPct: Number.NaN });
    const noEvidence = null;

    // When: invalid settings reach the assessment boundary.
    const negativeAssessment = () => assessResearchBusiness(noEvidence, new Date('2026-09-05T00:00:00Z'), { ...settingsFixture(), launchBudgetUsd: -1 });
    const nonFiniteAssessment = () => assessResearchBusiness(noEvidence, new Date('2026-09-05T00:00:00Z'), { ...settingsFixture(), minimumRoiPct: Number.NaN });

    // Then: complete finite administrator settings are required for every assessment.
    expect(missing.success).toBe(false);
    expect(incomplete.success).toBe(false);
    expect(injected.success).toBe(false);
    expect(negative.success).toBe(false);
    expect(nonFinite.success).toBe(false);
    expect(negativeAssessment).toThrow();
    expect(nonFiniteAssessment).toThrow();
  });

  it('rejects non-http source links before a UI can render them', () => {
    // Given: an otherwise sourced sale price with an executable URI scheme.
    const evidence = {
      ...evidenceFixture(),
      salePrice: {
        ...evidenceFixture().salePrice,
        source: {
          ...evidenceFixture().salePrice.source,
          url: 'javascript:alert(1)'
        }
      }
    };

    // When: the source link crosses the shared schema boundary.
    const result = ResearchBusinessEvidenceSchema.safeParse(evidence);

    // Then: only safe browser-link protocols are accepted.
    expect(result.success).toBe(false);
  });

  it('rejects a candidate-injected profitability policy', () => {
    // Given: an otherwise valid candidate payload includes its own approval thresholds.
    const evidence = {
      ...evidenceFixture(),
      minimumProfitabilityPolicy: {
        minimumPreAdMarginPct: 0,
        minimumPostAdMarginPct: 0,
        minimumRoiPct: 0
      }
    };

    // When: the payload crosses the shared evidence boundary.
    const result = ResearchBusinessEvidenceSchema.safeParse(evidence);

    // Then: only separate administrator settings can determine profitability criteria.
    expect(result.success).toBe(false);
  });

  it('requires a source for a non-USD amount converted to USD', () => {
    // Given: a foreign-currency launch cost has a USD value but no conversion evidence.
    const evidence = {
      ...evidenceFixture(),
      upfrontLaunchCost: {
        amount: 100,
        currency: 'CNY',
        amountUsd: 14,
        source: source('supplier-invoice', 'quote'),
        usdConversionSource: null
      }
    };

    // When: the cost is parsed for a USD launch-cash calculation.
    const result = ResearchBusinessEvidenceSchema.safeParse(evidence);

    // Then: the unsupported conversion cannot become usable cash evidence.
    expect(result.success).toBe(false);
  });

  it('keeps the full shipment total distinct from the landed unit cost', () => {
    // Given: a 100-unit quote whose unit cost and shipment total are both recorded.
    const evidence = ResearchBusinessEvidenceSchema.parse(evidenceFixture());

    // When: the launch cash is assessed.
    const result = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00Z'), settingsFixture());

    // Then: only 100 times the $10 unit cost is counted as inventory cash.
    expect(result.estimatedLaunchCashUsd).toBe(3000);
  });

  it('keeps exactly $3000 eligible while holding a $3000.01 plan', () => {
    // Given: one complete quote at the launch-cash boundary and one above it.
    const withinBudget = ResearchBusinessEvidenceSchema.parse(evidenceFixture());
    const aboveBudget = ResearchBusinessEvidenceSchema.parse({
      ...evidenceFixture(),
      launchReserveCash: quotedUsd(1400.01, 'launch-reserve-plan', 'estimate')
    });

    // When: both plans are assessed at the same time.
    const withinBudgetResult = assessResearchBusiness(withinBudget, new Date('2026-09-05T00:00:00Z'), settingsFixture());
    const aboveBudgetResult = assessResearchBusiness(aboveBudget, new Date('2026-09-05T00:00:00Z'), settingsFixture());

    // Then: cash and purchase-review eligibility remain separate at the exact boundary.
    expect(withinBudgetResult).toMatchObject({
      estimatedLaunchCashUsd: 3000,
      stage: 'purchase_review',
      purchaseApproved: false
    });
    expect(aboveBudgetResult).toMatchObject({
      estimatedLaunchCashUsd: 3000.01,
      stage: 'hold',
      purchaseApproved: false
    });
  });

  it('distinguishes unknown launch costs from a sourced zero-dollar cost', () => {
    // Given: one otherwise-complete plan with an unknown upfront cost and one quoted at zero.
    const unknownCost = ResearchBusinessEvidenceSchema.parse({
      ...evidenceFixture(),
      upfrontLaunchCost: unknownMoney()
    });
    const quotedZeroCost = ResearchBusinessEvidenceSchema.parse({
      ...evidenceFixture(),
      upfrontLaunchCost: quotedUsd(0, 'launch-cost-plan', 'estimate')
    });

    // When: their launch cash is assessed.
    const unknownResult = assessResearchBusiness(unknownCost, new Date('2026-09-05T00:00:00Z'), settingsFixture());
    const quotedZeroResult = assessResearchBusiness(quotedZeroCost, new Date('2026-09-05T00:00:00Z'), settingsFixture());

    // Then: unknown stays unknown while sourced zero remains a real $0 input.
    expect(unknownResult).toMatchObject({ estimatedLaunchCashUsd: null, stage: 'hold' });
    expect(quotedZeroResult.estimatedLaunchCashUsd).toBe(2900);
  });

  it('rejects negative and non-finite monetary values', () => {
    // Given: otherwise valid evidence with invalid landed-cost values.
    const negativeCost = {
      ...evidenceFixture(),
      selectedQuote: {
        ...evidenceFixture().selectedQuote,
        landedUnitCost: quotedUsd(-1, 'supplier-quote-01')
      }
    };
    const nonFiniteCost = {
      ...evidenceFixture(),
      selectedQuote: {
        ...evidenceFixture().selectedQuote,
        landedUnitCost: quotedUsd(Number.NaN, 'supplier-quote-01')
      }
    };

    // When: both inputs cross the schema boundary.
    const negativeResult = ResearchBusinessEvidenceSchema.safeParse(negativeCost);
    const nonFiniteResult = ResearchBusinessEvidenceSchema.safeParse(nonFiniteCost);

    // Then: neither invalid money value becomes business evidence.
    expect(negativeResult.success).toBe(false);
    expect(nonFiniteResult.success).toBe(false);
  });

  it('rejects an order quantity below the quote MOQ', () => {
    // Given: a quote whose MOQ exceeds the selected order quantity.
    const evidence = {
      ...evidenceFixture(),
      selectedQuote: {
        ...evidenceFixture().selectedQuote,
        minimumOrderQuantity: 101
      }
    };

    // When: it is parsed as commercial evidence.
    const result = ResearchBusinessEvidenceSchema.safeParse(evidence);

    // Then: the mismatched pairing is rejected before assessment.
    expect(result.success).toBe(false);
  });

  it('requires the selected unit cost to use the same quote reference as the MOQ', () => {
    // Given: an order quantity and MOQ from one quote with cost from another quote.
    const evidence = {
      ...evidenceFixture(),
      selectedQuote: {
        ...evidenceFixture().selectedQuote,
        landedUnitCost: quotedUsd(10, 'supplier-quote-02')
      }
    };

    // When: it is parsed as commercial evidence.
    const result = ResearchBusinessEvidenceSchema.safeParse(evidence);

    // Then: the unpaired quote data is rejected.
    expect(result.success).toBe(false);
  });

  it('requires the selected quote to reference the same product specification', () => {
    // Given: an otherwise complete quote for another specification reference.
    const evidence = {
      ...evidenceFixture(),
      selectedQuote: {
        ...evidenceFixture().selectedQuote,
        specificationReference: 'another-product-specification'
      }
    };

    // When: it is parsed as commercial evidence.
    const result = ResearchBusinessEvidenceSchema.safeParse(evidence);

    // Then: the cross-specification quote cannot enter the assessment.
    expect(result.success).toBe(false);
  });

  it('holds an expired quote before purchase review', () => {
    // Given: all commercial checks pass but the selected quote has expired.
    const evidence = ResearchBusinessEvidenceSchema.parse({
      ...evidenceFixture(),
      selectedQuote: {
        ...evidenceFixture().selectedQuote,
        expiresAt: '2026-09-04T00:00:00Z'
      }
    });

    // When: it is assessed after expiry.
    const result = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00Z'), settingsFixture());

    // Then: current commercial evidence is required before a purchase review.
    expect(result).toMatchObject({ stage: 'hold', purchaseApproved: false });
    expect(result.gaps).toContain('quote_expired');
  });

  it('holds a quote without complete landed-cost scope before purchase review', () => {
    // Given: the quote lacks an incoterm, destination, and complete landed-cost coverage.
    const evidence = ResearchBusinessEvidenceSchema.parse({
      ...evidenceFixture(),
      selectedQuote: {
        ...evidenceFixture().selectedQuote,
        incoterm: null,
        destination: null,
        leadTimeDays: null,
        landedShipmentTotal: unknownMoney(),
        landedCostCoverage: {
          product: 'included',
          packaging: 'unknown',
          freight: 'unknown',
          duties: 'unknown',
          delivery: 'unknown'
        }
      }
    });

    // When: it is assessed for a purchase review.
    const result = assessResearchBusiness(evidence, new Date('2026-09-05T00:00:00Z'), settingsFixture());

    // Then: incomplete delivery terms hold the commercial decision.
    expect(result).toMatchObject({ stage: 'hold', purchaseApproved: false });
    expect(result.gaps).toEqual(expect.arrayContaining([
      'quote_incoterm',
      'quote_destination',
      'quote_lead_time',
      'landed_cost_coverage',
      'landed_shipment_total'
    ]));
  });

  it('keeps seller estimates distinct from a market-validation decision', () => {
    // Given: a market pass supported by documented estimated market evidence.
    const evidence = ResearchBusinessEvidenceSchema.parse(evidenceFixture());

    // When: the evidence is parsed into the shared contract.
    const marketCheck = evidence.marketCheck;

    // Then: the seller quantity remains an estimate with its own estimate source.
    expect(marketCheck.sellerEstimatedMonthlySales).toBe(120);
    expect(marketCheck.sellerEstimateSource?.basis).toBe('estimate');
    expect(marketCheck.source?.basis).toBe('estimate');
  });

  it('accepts only selected Jungle Scout endpoints as requested research', () => {
    // Given: a complete evidence packet requesting one missing-data endpoint.
    const evidence = {
      ...evidenceFixture(),
      requestedApiPurposes: ['product_database']
    };

    // When: it crosses the schema boundary.
    const result = ResearchBusinessEvidenceSchema.safeParse(evidence);

    // Then: the endpoint is retained without changing the durable budget-purpose contract.
    expect(result.success).toBe(true);
  });

  it('fails closed on the latest malformed evidence row', () => {
    // Given: a valid older revision and a newer malformed revision.
    const rows = [
      {
        id: 'old',
        created_at: '2026-09-01T00:00:00Z',
        payload: evidenceFixture()
      },
      {
        id: 'new',
        created_at: '2026-09-02T00:00:00Z',
        payload: { kind: 'research_business_v1' }
      }
    ];

    // When: the newest evidence is selected.
    const result = selectLatestResearchBusiness(rows);

    // Then: the malformed newest revision blocks fallback to the old one.
    expect(result).toBeNull();
  });
});
