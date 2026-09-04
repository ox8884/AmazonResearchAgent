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
  readonly sourcePeriod: { readonly from: string | null; readonly to: string | null };
}

export interface ShareOfVoiceAnalysis {
  readonly source: 'share_of_voice';
  readonly observedOrEstimated: 'observed';
  readonly quality: 'ok' | 'unmapped_brands' | 'insufficient_share';
  readonly confidence: 'high' | 'low';
  readonly brandDominance: number | null;
  readonly topBrand: string | null;
  readonly sourcePeriod: { readonly from: string | null; readonly to: string | null };
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
  readonly points: readonly {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly searchVolume: number | null;
  }[];
}): HistoricalSearchAnalysis {
  const usable = input.points.filter(
    (point): point is {
      periodStart: string;
      periodEnd: string;
      searchVolume: number;
    } =>
      typeof point.searchVolume === 'number'
  );
  const periodStarts = usable.map((point) => point.periodStart);
  const periodEnds = usable.map((point) => point.periodEnd);
  if (usable.length < 6) {
    return {
      source: 'historical_search_volume',
      observedOrEstimated: 'observed',
      quality: 'insufficient_history',
      confidence: 'low',
      seasonalityIndex: null,
      seasonal: null,
      consistency: null,
      sourcePeriod: {
        from: periodStarts[0] ?? null,
        to: periodEnds[periodEnds.length - 1] ?? null
      }
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
    sourcePeriod: {
      from: periodStarts[0] ?? null,
      to: periodEnds[periodEnds.length - 1] ?? null
    }
  };
}

export function analyzeSalesEstimates(input: {
  readonly estimates: readonly {
    readonly asin: string;
    readonly estimatedMonthlySales: number | null;
    readonly dailySales?: readonly number[];
    readonly prices?: readonly number[];
  }[];
}): SalesEstimatesAnalysis {
  const salesScores = input.estimates
    .map((estimate) => stability(estimate.dailySales ?? []))
    .filter((value): value is number => value !== null);
  const priceScores = input.estimates
    .map((estimate) => stability(estimate.prices ?? []))
    .filter((value): value is number => value !== null);
  const salesStability =
    salesScores.length === 0
      ? null
      : salesScores.reduce((sum, value) => sum + value, 0) / salesScores.length;
  const priceStability =
    priceScores.length === 0
      ? null
      : priceScores.reduce((sum, value) => sum + value, 0) / priceScores.length;
  const quality = salesStability === null ? 'insufficient_history' : 'ok';
  return {
    source: 'sales_estimates',
    observedOrEstimated: 'estimated',
    quality,
    confidence: quality === 'ok' ? 'high' : 'low',
    salesStability,
    priceStability,
    sourcePeriod: { from: null, to: null }
  };
}

export function analyzeShareOfVoice(input: {
  readonly brands: readonly { readonly brand: string; readonly share: number | null }[];
}): ShareOfVoiceAnalysis {
  const brandShares = new Map<string, number>();
  let totalShare = 0;
  for (const row of input.brands) {
    if (row.share === null) {
      continue;
    }
    totalShare += row.share;
    brandShares.set(row.brand, (brandShares.get(row.brand) ?? 0) + row.share);
  }
  if (totalShare <= 0) {
    return {
      source: 'share_of_voice',
      observedOrEstimated: 'observed',
      quality: 'insufficient_share',
      confidence: 'low',
      brandDominance: null,
      topBrand: null,
      sourcePeriod: { from: null, to: null }
    };
  }
  const ranked = [...brandShares.entries()].sort((left, right) => right[1] - left[1]);
  const [topBrand, topShare] = ranked[0] ?? [null, 0];
  return {
    source: 'share_of_voice',
    observedOrEstimated: 'observed',
    quality: 'ok',
    confidence: 'high',
    brandDominance: topShare / totalShare,
    topBrand,
    sourcePeriod: { from: null, to: null }
  };
}
