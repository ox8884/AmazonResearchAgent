import type { ProductFamily } from './product-family';

export interface MarketMetrics {
  readonly observedSampleSales: number;
  readonly estimatedMarketSales: number | null;
  readonly top3SalesConcentration: number;
  readonly top10AverageReviews: number | null;
  readonly medianReviews: number | null;
  readonly shareOver1000Reviews: number;
  readonly brandConcentration: number;
  readonly amazonRetailPresent: boolean;
  readonly familyCount: number;
  readonly priceCompression: number | null;
  readonly newerLowReviewSellerSuccess: number | null;
  readonly historicalTrendConsistency: number | null;
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
    .map((family) => {
      const known = family.variants
        .map((variant) => variant.reviews)
        .filter((value): value is number => value !== null);
      if (known.length === 0) {
        return null;
      }
      return Math.max(...known);
    })
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const mid = Math.floor(reviews.length / 2);
  const brandCounts = new Map<string, number>();
  let amazonRetailPresent = false;
  const familyMedianPrices: number[] = [];
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
    const prices = family.variants
      .map((variant) => variant.price)
      .filter((price): price is number => price !== null)
      .sort((left, right) => left - right);
    const priceMid = prices[Math.floor(prices.length / 2)];
    if (priceMid !== undefined) {
      familyMedianPrices.push(priceMid);
    }
  }
  const brandSales = [...brandCounts.values()].sort((left, right) => right - left);
  const topBrand = brandSales[0] ?? 0;
  const sortedPrices = [...familyMedianPrices].sort((left, right) => left - right);
  const priceMedian = sortedPrices[Math.floor(sortedPrices.length / 2)];
  const priceCompression =
    priceMedian && priceMedian > 0 && sortedPrices.length >= 2
      ? (sortedPrices[sortedPrices.length - 1]! - sortedPrices[0]!) / priceMedian
      : null;

  return {
    observedSampleSales,
    estimatedMarketSales: null,
    top3SalesConcentration:
      observedSampleSales === 0 ? 0 : top3 / observedSampleSales,
    top10AverageReviews:
      reviews.length === 0
        ? null
        : reviews.slice(-10).reduce((sum, value) => sum + value, 0) /
          Math.max(1, Math.min(10, reviews.length)),
    medianReviews: reviews.length === 0 ? null : (reviews[mid] ?? null),
    shareOver1000Reviews:
      families.length === 0
        ? 0
        : families.filter((family) =>
            family.variants.some((variant) => variant.reviews !== null && variant.reviews > 1000)
          ).length / families.length,
    brandConcentration:
      observedSampleSales === 0 ? 0 : topBrand / observedSampleSales,
    amazonRetailPresent,
    familyCount: families.length,
    priceCompression,
    newerLowReviewSellerSuccess: null,
    historicalTrendConsistency: null
  };
}
