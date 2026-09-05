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
});
