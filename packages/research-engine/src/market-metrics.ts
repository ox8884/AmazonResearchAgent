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

function isAmazonRetail(sellerType: string | null | undefined): boolean {
  if (!sellerType) {
    return false;
  }
  const normalized = sellerType.trim().toLocaleLowerCase('en-US');
  return normalized === 'amz' || normalized === 'amazon' || normalized === 'amazon_retail';
}

function listingAgeDays(listingDate: string | null | undefined, now: Date): number | null {
  if (!listingDate) {
    return null;
  }
  const parsed = Date.parse(listingDate);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return (now.getTime() - parsed) / (24 * 60 * 60 * 1000);
}

export function calculateMarketMetrics(
  families: readonly ProductFamily[],
  options: { readonly now?: Date; readonly historicalTrendConsistency?: number | null } = {}
): MarketMetrics {
  const now = options.now ?? new Date();
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
  let datedFamilies = 0;
  let newerLowReviewSuccesses = 0;
  for (const family of families) {
    const brand = family.variants[0]?.brand ?? 'unknown';
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + family.observedMonthlyUnits);
    if (family.variants.some((variant) => isAmazonRetail(variant.sellerType))) {
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
    const listingDate = family.variants
      .map((variant) => variant.listingDate)
      .find((value) => typeof value === 'string' && value.length > 0);
    const age = listingAgeDays(listingDate, now);
    if (age !== null) {
      datedFamilies += 1;
      const familyReviews = family.variants
        .map((variant) => variant.reviews)
        .filter((value): value is number => value !== null);
      const maxReviews = familyReviews.length === 0 ? null : Math.max(...familyReviews);
      if (age <= 365 && maxReviews !== null && maxReviews < 100 && family.observedMonthlyUnits > 0) {
        newerLowReviewSuccesses += 1;
      }
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
    newerLowReviewSellerSuccess:
      datedFamilies === 0 ? null : newerLowReviewSuccesses / datedFamilies,
    historicalTrendConsistency: options.historicalTrendConsistency ?? null
  };
}
