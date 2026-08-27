import { describe, expect, it } from 'vitest';
import { calculateAllowableLandedCost } from './economics';

describe('allowable landed cost', () => {
  // Break: post-ad ads are ignored or a supplier quote is invented.
  it('calculates max landed cost required for a 30 percent pre-ad margin', () => {
    const result = calculateAllowableLandedCost({
      salePrice: 29.99,
      amazonFees: 10.33,
      targetPreAdMarginPct: 30,
      expectedAdPct: 10,
      targetPostAdMarginPct: 20
    });

    expect(result.maxLandedCostForPreAd).toBeCloseTo(10.663, 3);
    expect(result.maxLandedCostForPostAd).toBeCloseTo(7.664, 3);
    expect(result.economicsSource).toBe('estimated_assumption');
  });
});
