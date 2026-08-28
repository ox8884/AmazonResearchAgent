export interface HistoricalSearchAnalysis {
  readonly source: 'historical_search_volume';
  readonly observedOrEstimated: 'observed';
  readonly quality: 'ok' | 'insufficient_history';
  readonly confidence: 'high' | 'low';
  readonly seasonalityIndex: number | null;
  readonly seasonal: boolean | null;
  readonly consistency: number | null;
  readonly sourcePeriod: { readonly from: string | null; readonly to: string | null };
}

export interface SalesEstimatesAnalysis {
  readonly source: 'sales_estimates';
  readonly observedOrEstimated: 'estimated';
  readonly quality: 'ok' | 'insufficient_history';
  readonly confidence: 'high' | 'low';
  readonly salesStability: number | null;
  readonly priceStability: number | null;
}

export interface ShareOfVoiceAnalysis {
  readonly source: 'share_of_voice';
  readonly observedOrEstimated: 'observed';
  readonly quality: 'ok' | 'unmapped_brands' | 'insufficient_share';
  readonly confidence: 'high' | 'low';
  readonly brandDominance: number | null;
  readonly topBrand: string | null;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: readonly number[]): number {
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function stability(values: readonly number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const avg = mean(values);
  if (avg <= 0) {
    return null;
  }
  return 1 - Math.min(1, stdev(values) / avg);
}

export function analyzeHistoricalSearchVolume(input: {
  readonly points: readonly { readonly month: string; readonly searchVolume: number | null }[];
}): HistoricalSearchAnalysis {
  const usable = input.points.filter(
    (point): point is { month: string; searchVolume: number } =>
      typeof point.searchVolume === 'number'
  );
  const months = usable.map((point) => point.month);
  if (usable.length < 6) {
    return {
      source: 'historical_search_volume',
      observedOrEstimated: 'observed',
      quality: 'insufficient_history',
      confidence: 'low',
      seasonalityIndex: null,
      seasonal: null,
      consistency: null,
      sourcePeriod: { from: months[0] ?? null, to: months[months.length - 1] ?? null }
    };
  }
  const volumes = usable.map((point) => point.searchVolume);
  const avg = mean(volumes);
  const seasonalityIndex = avg > 0 ? (Math.max(...volumes) - Math.min(...volumes)) / avg : null;
  return {
    source: 'historical_search_volume',
    observedOrEstimated: 'observed',
    quality: 'ok',
    confidence: 'high',
    seasonalityIndex,
    seasonal: seasonalityIndex !== null && seasonalityIndex >= 0.4,
    consistency: stability(volumes),
    sourcePeriod: { from: months[0] ?? null, to: months[months.length - 1] ?? null }
  };
}

export function analyzeSalesEstimates(input: {
  readonly monthlySales: readonly (number | null)[];
  readonly prices?: readonly (number | null)[];
}): SalesEstimatesAnalysis {
  const sales = input.monthlySales.filter((value): value is number => value !== null);
  const prices = (input.prices ?? []).filter((value): value is number => value !== null);
  const salesStability = stability(sales);
  const priceStability = stability(prices);
  const quality = sales.length >= 2 ? 'ok' : 'insufficient_history';
  return {
    source: 'sales_estimates',
    observedOrEstimated: 'estimated',
    quality,
    confidence: quality === 'ok' ? 'high' : 'low',
    salesStability,
    priceStability
  };
}

export function analyzeShareOfVoice(input: {
  readonly rows: readonly { readonly asin: string; readonly share: number | null }[];
  readonly brandByAsin: Readonly<Record<string, string | null | undefined>>;
}): ShareOfVoiceAnalysis {
  const brandShares = new Map<string, number>();
  let mappedShare = 0;
  let totalShare = 0;
  for (const row of input.rows) {
    if (row.share === null) {
      continue;
    }
    totalShare += row.share;
    const brand = input.brandByAsin[row.asin];
    if (!brand) {
      continue;
    }
    mappedShare += row.share;
    brandShares.set(brand, (brandShares.get(brand) ?? 0) + row.share);
  }
  if (mappedShare <= 0 || totalShare <= 0) {
    return {
      source: 'share_of_voice',
      observedOrEstimated: 'observed',
      quality: 'insufficient_share',
      confidence: 'low',
      brandDominance: null,
      topBrand: null
    };
  }
  const ranked = [...brandShares.entries()].sort((left, right) => right[1] - left[1]);
  const [topBrand, topShare] = ranked[0] ?? [null, 0];
  return {
    source: 'share_of_voice',
    observedOrEstimated: 'observed',
    quality: mappedShare < totalShare ? 'unmapped_brands' : 'ok',
    confidence: mappedShare < totalShare ? 'low' : 'high',
    brandDominance: topShare / mappedShare,
    topBrand
  };
}
