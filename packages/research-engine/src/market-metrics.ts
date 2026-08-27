import type { ProductFamily } from './product-family';

export interface MarketMetrics {
  readonly observedSampleSales: number;
  readonly estimatedMarketSales: number | null;
  readonly top3SalesConcentration: number;
  readonly top10AverageReviews: number;
  readonly medianReviews: number;
  readonly shareOver1000Reviews: number;
  readonly brandConcentration: number;
  readonly amazonRetailPresent: boolean;
  readonly familyCount: number;
}

export function calculateMarketMetrics(
  families: readonly ProductFamily[]
): MarketMetrics {
  const sales = families
    .map((family) => family.observedMonthlyUnits)
    .sort((left, right) => right - left);
  const observedSampleSales = sales.reduce((sum, value) => sum + value, 0);
  const top3 = sales.slice(0, 3).reduce((sum, value) => sum + value, 0);
  const reviews = families
    .map((family) =>
      family.variants.reduce((max, variant) => Math.max(max, variant.reviews ?? 0), 0)
    )
    .sort((left, right) => left - right);
  const mid = Math.floor(reviews.length / 2);
  const brandCounts = new Map<string, number>();
  let amazonRetailPresent = false;
  for (const family of families) {
    const brand = family.variants[0]?.brand ?? 'unknown';
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + family.observedMonthlyUnits);
    if (
      family.variants.some((variant) =>
        (variant.brand ?? '').toLocaleLowerCase('en-US').includes('amazon')
      )
    ) {
      amazonRetailPresent = true;
    }
  }
  const brandSales = [...brandCounts.values()].sort((left, right) => right - left);
  const topBrand = brandSales[0] ?? 0;

  return {
    observedSampleSales,
    estimatedMarketSales: null,
    top3SalesConcentration:
      observedSampleSales === 0 ? 0 : top3 / observedSampleSales,
    top10AverageReviews:
      reviews.slice(-10).reduce((sum, value) => sum + value, 0) /
      Math.max(1, Math.min(10, reviews.length)),
    medianReviews: reviews[mid] ?? 0,
    shareOver1000Reviews:
      families.length === 0
        ? 0
        : families.filter((family) =>
            family.variants.some((variant) => (variant.reviews ?? 0) > 1000)
          ).length / families.length,
    brandConcentration:
      observedSampleSales === 0 ? 0 : topBrand / observedSampleSales,
    amazonRetailPresent,
    familyCount: families.length
  };
}
