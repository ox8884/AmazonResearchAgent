import { describe, expect, it } from 'vitest';
import { evaluateProductDataQuality } from './data-quality';

describe('market data quality', () => {
  // Break: missing price is treated as zero or a fake unit price is invented.
  it('flags missing price and revenue per unit inconsistency', () => {
    const result = evaluateProductDataQuality({
      price: null,
      units: 3505,
      revenue: 9449,
      reviews: 12,
      rating: null,
      weight: null,
      updatedAt: '2026-08-27T01:32:04Z',
      now: new Date('2026-08-28T00:00:00Z')
    });

    expect(result.flags).toContain('MISSING_PRICE');
    expect(result.flags).toContain('MISSING_RATING');
    expect(result.flags).toContain('MISSING_WEIGHT');
    expect(result.flags).not.toContain('REVENUE_PRICE_MISMATCH');
    expect(result.confidence).toBeLessThan(1);
  });

  it('flags revenue that diverges from listed price', () => {
    const result = evaluateProductDataQuality({
      price: 20,
      units: 10,
      revenue: 400,
      reviews: 5,
      rating: 4,
      weight: 1,
      updatedAt: '2026-08-27T01:32:04Z',
      now: new Date('2026-08-28T00:00:00Z')
    });

    expect(result.flags).toContain('REVENUE_PRICE_MISMATCH');
  });
});
