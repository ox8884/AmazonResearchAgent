export const DATA_QUALITY_FLAGS = [
  'MISSING_PRICE',
  'MISSING_WEIGHT',
  'MISSING_REVIEWS',
  'MISSING_RATING',
  'REVENUE_PRICE_MISMATCH',
  'VARIANT_SALES_DUPLICATED',
  'STALE_SOURCE'
] as const;
export type DataQualityFlag = (typeof DATA_QUALITY_FLAGS)[number];

export interface DataQualityInput {
  readonly price: number | null;
  readonly units: number | null;
  readonly revenue: number | null;
  readonly reviews: number | null;
  readonly rating: number | null;
  readonly weight: number | null;
  readonly updatedAt: string | null;
  readonly variantSalesDuplicated?: boolean;
  readonly now?: Date;
}

export interface DataQualityResult {
  readonly flags: readonly DataQualityFlag[];
  readonly confidence: number;
}

const STALE_MS = 30 * 24 * 60 * 60 * 1000;

export function evaluateProductDataQuality(input: DataQualityInput): DataQualityResult {
  const flags: DataQualityFlag[] = [];
  if (input.price === null) flags.push('MISSING_PRICE');
  if (input.weight === null) flags.push('MISSING_WEIGHT');
  if (input.reviews === null) flags.push('MISSING_REVIEWS');
  if (input.rating === null) flags.push('MISSING_RATING');
  if (input.variantSalesDuplicated) flags.push('VARIANT_SALES_DUPLICATED');
  if (
    input.price !== null &&
    input.units !== null &&
    input.units > 0 &&
    input.revenue !== null &&
    Math.abs(input.revenue / input.units - input.price) / input.price > 0.35
  ) {
    flags.push('REVENUE_PRICE_MISMATCH');
  }
  if (input.updatedAt) {
    const updated = Date.parse(input.updatedAt);
    const now = (input.now ?? new Date()).getTime();
    if (Number.isFinite(updated) && now - updated > STALE_MS) {
      flags.push('STALE_SOURCE');
    }
  }

  return {
    flags,
    confidence: Math.max(0, 1 - flags.length * 0.15)
  };
}
