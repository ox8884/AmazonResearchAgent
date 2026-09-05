export interface AllowableLandedCostInput {
  readonly salePrice: number;
  readonly amazonFees: number;
  readonly targetPreAdMarginPct: number;
  readonly expectedAdPct: number;
  readonly targetPostAdMarginPct: number;
}

export interface AllowableLandedCost {
  readonly maxLandedCostForPreAd: number;
  readonly maxLandedCostForPostAd: number;
  readonly economicsSource: 'estimated_assumption';
}

export function calculateAllowableLandedCost(
  input: AllowableLandedCostInput
): AllowableLandedCost {
  const maxLandedCostForPreAd =
    input.salePrice * (1 - input.targetPreAdMarginPct / 100) - input.amazonFees;
  return {
    maxLandedCostForPreAd,
    maxLandedCostForPostAd:
      input.salePrice *
        (1 - input.targetPostAdMarginPct / 100 - input.expectedAdPct / 100) -
      input.amazonFees,
    economicsSource: 'estimated_assumption'
  };
}
