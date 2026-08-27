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
});
