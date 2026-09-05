import { describe, expect, it } from 'vitest';
import { calculateMarketMetrics } from '../market-metrics';
import { groupProductFamilies, type CatalogProduct } from '../product-family';
import { scoreMarketOpportunity } from './market-score';

function familyProduct(id: string, units: number, reviews = 100): CatalogProduct {
  return {
    id,
    title: `Product ${id}`,
    parentAsin: id,
    unitsSold30: units,
    revenue30: units * 20,
    price: 20,
    reviews,
    rating: 4,
    brand: `Brand-${id}`,
    weight: 1,
    updatedAt: '2026-08-27T01:32:04Z'
  };
}

describe('market metrics and scoring', () => {
  // Break: sample sales are treated as full-market size or variants inflate concentration.
  it('calculates top-3 sales concentration from family sales', () => {
    const metrics = calculateMarketMetrics(
      groupProductFamilies([
        familyProduct('A', 1000),
        familyProduct('B', 500),
        familyProduct('C', 250),
        familyProduct('D', 250)
      ])
    );

    expect(metrics.top3SalesConcentration).toBe(0.875);
    expect(metrics.observedSampleSales).toBe(2000);
    expect(metrics.estimatedMarketSales).toBeNull();
  });

  it('rejects when a hard filter fails regardless of numeric score', () => {
    const result = scoreMarketOpportunity({
      metrics: calculateMarketMetrics(
        groupProductFamilies([familyProduct('A', 5000, 50)])
      ),
      hardFilterFailed: true,
      hardFilterReason: 'Fragile glass',
      marginProvisional: false,
      differentiationMode: 'review_text',
      ipRisk: false
    });

    expect(result.verdict).toBe('Reject');
    expect(result.total).toBe(0);
  });

  it('keeps missing market evidence from becoming a strong opportunity', () => {
    const result = scoreMarketOpportunity({
      metrics: null,
      hardFilterFailed: false,
      marginProvisional: false,
      differentiationMode: 'review_text',
      ipRisk: false
    });

    expect(result.verdict).toBe('Needs Review');
    expect(result.total).toBe(0);
  });

  it('detects Amazon retail from seller_type instead of brand text', () => {
    const amazonBrand = calculateMarketMetrics(
      groupProductFamilies([{ ...familyProduct('A', 100), brand: 'Amazon Basics' }])
    );
    const amazonSeller = calculateMarketMetrics(
      groupProductFamilies([{ ...familyProduct('B', 100), sellerType: 'AMZ' }])
    );
    expect(amazonBrand.amazonRetailPresent).toBe(false);
    expect(amazonSeller.amazonRetailPresent).toBe(true);
  });

  it('scores newer low-review seller success only when listing date exists', () => {
    const now = new Date('2026-08-28T00:00:00.000Z');
    const metrics = calculateMarketMetrics(
      groupProductFamilies([
        { ...familyProduct('NEW', 400, 20), listingDate: '2026-06-01' },
        { ...familyProduct('OLD', 400, 20), listingDate: '2024-01-01' }
      ]),
      { now }
    );
    expect(metrics.newerLowReviewSellerSuccess).toBe(0.5);
    const unknown = calculateMarketMetrics(groupProductFamilies([familyProduct('X', 100)]));
    expect(unknown.newerLowReviewSellerSuccess).toBeNull();
    expect(unknown.historicalTrendConsistency).toBeNull();
  });

});
