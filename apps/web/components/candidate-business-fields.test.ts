import { describe, expect, it } from 'vitest';
import { ResearchBusinessEvidenceSchema } from '@ara/shared';
import { businessEvidenceFrom, initialBusinessFormValues } from './candidate-business-values';

const evidence = ResearchBusinessEvidenceSchema.parse({
  kind: 'research_business_v1',
  specification: { reference: 'bamboo utensil holder v1', description: 'A bamboo utensil holder with removable drip tray.' }, marketplace: 'US', disposition: 'research',
  brandFit: { status: 'pass', source: { reference: 'brand registry review', url: null, recordedAt: '2026-09-01T00:00:00.000Z', basis: 'observed' } },
  salePrice: { amount: 30, currency: 'USD', amountUsd: 30, source: { reference: 'Amazon detail observation', url: 'https://amazon.example/item', recordedAt: '2026-09-01T00:00:00.000Z', basis: 'observed' }, usdConversionSource: null },
  amazonUnitCosts: {
    referralFee: { amount: 3, currency: 'USD', amountUsd: 3, source: { reference: 'FBA calculator referral', url: null, recordedAt: '2026-09-01T00:00:00.000Z', basis: 'observed' }, usdConversionSource: null },
    fulfillmentFee: { amount: 4, currency: 'USD', amountUsd: 4, source: { reference: 'FBA calculator fulfillment', url: null, recordedAt: '2026-09-01T00:00:00.000Z', basis: 'observed' }, usdConversionSource: null },
    otherVariableCost: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null }
  },
  selectedQuote: {
    source: { reference: 'Supplier quote Q-17', url: 'https://supplier.example/q-17', recordedAt: '2026-09-02T00:00:00.000Z', basis: 'quote' }, supplierName: 'Example supplier', specificationReference: 'bamboo utensil holder v1', orderQuantity: 100, minimumOrderQuantity: 100,
    landedUnitCost: { amount: 10, currency: 'CAD', amountUsd: 7, source: { reference: 'Supplier quote Q-17', url: 'https://supplier.example/q-17', recordedAt: '2026-09-02T00:00:00.000Z', basis: 'quote' }, usdConversionSource: { reference: 'CAD/USD rate', url: null, recordedAt: '2026-09-02T00:00:00.000Z', basis: 'observed' } },
    landedShipmentTotal: { amount: 1000, currency: 'CAD', amountUsd: 700, source: { reference: 'Supplier quote Q-17', url: 'https://supplier.example/q-17', recordedAt: '2026-09-02T00:00:00.000Z', basis: 'quote' }, usdConversionSource: { reference: 'CAD/USD rate', url: null, recordedAt: '2026-09-02T00:00:00.000Z', basis: 'observed' } },
    expiresAt: '2026-12-01T00:00:00.000Z', incoterm: 'DDP', destination: 'Dallas, TX', leadTimeDays: 25,
    landedCostCoverage: { product: 'included', packaging: 'included', freight: 'included', duties: 'included', delivery: 'included' }
  },
  upfrontLaunchCost: { amount: 100, currency: 'USD', amountUsd: 100, source: { reference: 'launch plan', url: null, recordedAt: '2026-09-02T00:00:00.000Z', basis: 'estimate' }, usdConversionSource: null },
  launchAdvertisingCash: { amount: 100, currency: 'USD', amountUsd: 100, source: { reference: 'launch plan', url: null, recordedAt: '2026-09-02T00:00:00.000Z', basis: 'estimate' }, usdConversionSource: null },
  launchReserveCash: { amount: 100, currency: 'USD', amountUsd: 100, source: { reference: 'launch plan', url: null, recordedAt: '2026-09-02T00:00:00.000Z', basis: 'estimate' }, usdConversionSource: null },
  perUnitAdCost: { amount: 3, currency: 'USD', amountUsd: 3, source: { reference: 'PPC estimate', url: null, recordedAt: '2026-09-02T00:00:00.000Z', basis: 'estimate' }, usdConversionSource: null },
  perUnitReturnCost: { amount: 1, currency: 'USD', amountUsd: 1, source: { reference: 'returns estimate', url: null, recordedAt: '2026-09-02T00:00:00.000Z', basis: 'estimate' }, usdConversionSource: null },
  marketCheck: {
    status: 'pass', source: { reference: 'Top Products notes', url: null, recordedAt: '2026-09-03T00:00:00.000Z', basis: 'observed' }, sourcePeriod: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z' }, comparisonRationale: 'Matches the reviewed comparable product family.', sellerEstimatedMonthlySales: 1200,
    sellerEstimateSource: { reference: 'Sales estimate', url: null, recordedAt: '2026-09-03T00:00:00.000Z', basis: 'estimate' }
  },
  sampleCheck: { status: 'unknown', source: null }, safetyIpCheck: { status: 'unknown', source: null }, requestedApiPurposes: ['sales_estimates']
});

describe('candidate business form provenance', () => {
  it('round-trips untouched evidence without merging sources, conversion evidence, or quote totals', () => {
    expect(businessEvidenceFrom(initialBusinessFormValues(evidence), evidence)).toEqual({ kind: 'valid', evidence });
  });

  it('preserves unchanged money sources while recording a quote wait, coverage, and changed quote source', () => {
    const values = {
      ...initialBusinessFormValues(evidence),
      disposition: 'awaiting_quote' as const,
      sourceBasis: 'quote' as const,
      productCoverage: 'included' as const,
      packagingCoverage: 'excluded' as const,
      freightCoverage: 'included' as const,
      dutiesCoverage: 'included' as const,
      deliveryCoverage: 'included' as const
    };

    const result = businessEvidenceFrom(values, evidence);

    expect(result).toMatchObject({
      kind: 'valid',
      evidence: {
        disposition: 'awaiting_quote',
        selectedQuote: {
          source: { basis: 'quote' },
          landedUnitCost: { source: { basis: 'quote' } },
          landedShipmentTotal: { source: { basis: 'quote' } },
          landedCostCoverage: {
            product: 'included',
            packaging: 'excluded',
            freight: 'included',
            duties: 'included',
            delivery: 'included'
          }
        }
      }
    });
    if (result.kind !== 'valid') throw new Error('Expected valid business evidence');
    expect(result.evidence.salePrice).toEqual(evidence.salePrice);
    expect(result.evidence.amazonUnitCosts).toEqual(evidence.amazonUnitCosts);
  });

  it('preserves observed market provenance when only the comparison rationale changes', () => {
    const result = businessEvidenceFrom({
      ...initialBusinessFormValues(evidence),
      comparisonRationale: 'Updated Top Products comparison after the saved observation.'
    }, evidence);

    if (result.kind !== 'valid') throw new Error('Expected valid business evidence');
    expect(result.evidence.marketCheck.source).toEqual(evidence.marketCheck.source);
    expect(result.evidence.selectedQuote).toEqual(evidence.selectedQuote);
    expect(result.evidence.salePrice).toEqual(evidence.salePrice);
  });

  it('requires an explicit valid market observation source when changing market evidence', () => {
    const result = businessEvidenceFrom({
      ...initialBusinessFormValues(evidence),
      marketSourceReference: '',
      marketSourceUrl: '',
      marketSourceRecordedAt: '',
      comparisonRationale: 'Updated Top Products comparison after the saved observation.'
    }, evidence);

    expect(result).toMatchObject({ kind: 'invalid' });
  });

  it('records an explicitly edited market observation separately from quote and money provenance', () => {
    const result = businessEvidenceFrom({
      ...initialBusinessFormValues(evidence),
      marketSourceReference: 'Top Products follow-up',
      marketSourceUrl: 'https://market.example/top-products',
      marketSourceBasis: 'observed',
      marketSourceRecordedAt: '2026-09-04T15:30',
      comparisonRationale: 'Updated Top Products comparison after the saved observation.'
    }, evidence);

    if (result.kind !== 'valid') throw new Error('Expected valid business evidence');
    expect(result.evidence.marketCheck.source).toEqual({
      reference: 'Top Products follow-up',
      url: 'https://market.example/top-products',
      basis: 'observed',
      recordedAt: '2026-09-04T15:30:00.000Z'
    });
    expect(result.evidence.selectedQuote).toEqual(evidence.selectedQuote);
    expect(result.evidence.salePrice).toEqual(evidence.salePrice);
  });

  it('applies a source-only market edit without replacing a stored nonzero-seconds observation time', () => {
    const saved = ResearchBusinessEvidenceSchema.parse({
      ...evidence,
      marketCheck: {
        ...evidence.marketCheck,
        source: { ...evidence.marketCheck.source, recordedAt: '2026-09-03T00:00:17.123Z' },
        sourcePeriod: { from: '2026-08-01T00:00:17.123Z', to: '2026-08-31T23:59:42.456Z' }
      }
    });
    const result = businessEvidenceFrom({
      ...initialBusinessFormValues(saved),
      marketSourceUrl: 'https://market.example/top-products-revised'
    }, saved);

    if (result.kind !== 'valid') throw new Error('Expected valid business evidence');
    expect(result.evidence.marketCheck.source).toEqual({
      reference: 'Top Products notes',
      url: 'https://market.example/top-products-revised',
      basis: 'observed',
      recordedAt: '2026-09-03T00:00:17.123Z'
    });
    expect(result.evidence.marketCheck.sourcePeriod).toEqual(saved.marketCheck.sourcePeriod);
  });

  it('treats an explicitly edited market timestamp as UTC', () => {
    const result = businessEvidenceFrom({
      ...initialBusinessFormValues(evidence),
      marketSourceRecordedAt: '2026-09-04T15:30'
    }, evidence);

    if (result.kind !== 'valid') throw new Error('Expected valid business evidence');
    expect(result.evidence.marketCheck.source).toMatchObject({
      basis: 'observed',
      recordedAt: '2026-09-04T15:30:00.000Z'
    });
  });

  it('preserves an untouched market period endpoint when the other endpoint changes', () => {
    const saved = ResearchBusinessEvidenceSchema.parse({
      ...evidence,
      marketCheck: {
        ...evidence.marketCheck,
        sourcePeriod: { from: '2026-08-01T00:00:17.123Z', to: '2026-08-31T23:59:42.456Z' }
      }
    });
    const result = businessEvidenceFrom({
      ...initialBusinessFormValues(saved),
      marketPeriodTo: '2026-09-01T00:01'
    }, saved);

    if (result.kind !== 'valid') throw new Error('Expected valid business evidence');
    expect(result.evidence.marketCheck.sourcePeriod).toEqual({
      from: '2026-08-01T00:00:17.123Z',
      to: '2026-09-01T00:01:00.000Z'
    });
  });

  it('preserves an untouched quote expiry when quote metadata changes', () => {
    const saved = ResearchBusinessEvidenceSchema.parse({
      ...evidence,
      selectedQuote: { ...evidence.selectedQuote, expiresAt: '2026-12-01T06:00:42.456Z' }
    });
    const result = businessEvidenceFrom({
      ...initialBusinessFormValues(saved),
      supplierName: 'Updated supplier name'
    }, saved);

    if (result.kind !== 'valid') throw new Error('Expected valid business evidence');
    expect(result.evidence.selectedQuote?.expiresAt).toBe('2026-12-01T06:00:42.456Z');
  });

  it('treats an explicitly edited quote expiry as UTC', () => {
    const result = businessEvidenceFrom({
      ...initialBusinessFormValues(evidence),
      quoteExpiresAt: '2026-12-02T09:31'
    }, evidence);

    if (result.kind !== 'valid') throw new Error('Expected valid business evidence');
    expect(result.evidence.selectedQuote?.expiresAt).toBe('2026-12-02T09:31:00.000Z');
  });

  it('rejects an invalid nonblank datetime instead of clearing its evidence', () => {
    const result = businessEvidenceFrom({
      ...initialBusinessFormValues(evidence),
      marketPeriodTo: 'not-a-datetime'
    }, evidence);

    expect(result).toMatchObject({ kind: 'invalid' });
  });
});
