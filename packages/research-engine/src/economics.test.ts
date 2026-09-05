import { describe, expect, it } from 'vitest';
import { calculateAllowableLandedCost } from './economics';

describe('allowable landed cost', () => {
  it('uses the post-ad target independently of the pre-ad target', () => {
    // Given: distinct pre-ad and post-ad margin targets with advertising costs.
    const result = calculateAllowableLandedCost({
      salePrice: 29.99,
      amazonFees: 10.33,
      targetPreAdMarginPct: 30,
      expectedAdPct: 10,
      targetPostAdMarginPct: 20
    });

    // When: allowable landed costs are calculated.

    // Then: the post-ad target has its own calculation rather than a second ad deduction.
    expect(result.maxLandedCostForPreAd).toBeCloseTo(10.663, 3);
    expect(result.maxLandedCostForPostAd).toBeCloseTo(10.663, 3);
    expect(result.economicsSource).toBe('estimated_assumption');
  });

  it('applies the post-ad margin target and advertising percentage directly', () => {
    // Given: a less conservative pre-ad target than the post-ad target.
    const result = calculateAllowableLandedCost({
      salePrice: 100,
      amazonFees: 20,
      targetPreAdMarginPct: 20,
      expectedAdPct: 10,
      targetPostAdMarginPct: 30
    });

    // When: allowable landed costs are calculated.

    // Then: each ceiling reflects its stated target.
    expect(result).toMatchObject({
      maxLandedCostForPreAd: 60,
      maxLandedCostForPostAd: 40
    });
  });
});
