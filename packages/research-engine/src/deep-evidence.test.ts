import { describe, expect, it } from 'vitest';
import {
  analyzeHistoricalSearchVolume,
  analyzeSalesEstimates,
  analyzeShareOfVoice
} from './deep-evidence';

describe('Task 11 derived analyses', () => {
  it('leaves seasonality unknown when fewer than six monthly points exist', () => {
    const result = analyzeHistoricalSearchVolume({
      points: [
        { periodStart: '2026-01-04', periodEnd: '2026-01-10', searchVolume: 100 },
        { periodStart: '2026-01-11', periodEnd: '2026-01-17', searchVolume: 110 }
      ]
    });
    expect(result.seasonalityIndex).toBeNull();
    expect(result.consistency).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('flags seasonal Historical Search Volume when range exceeds 40% of mean', () => {
    const result = analyzeHistoricalSearchVolume({
      points: [
        { periodStart: '2025-03-02', periodEnd: '2025-03-08', searchVolume: 100 },
        { periodStart: '2025-03-09', periodEnd: '2025-03-15', searchVolume: 100 },
        { periodStart: '2025-03-16', periodEnd: '2025-03-22', searchVolume: 100 },
        { periodStart: '2025-03-23', periodEnd: '2025-03-29', searchVolume: 100 },
        { periodStart: '2025-03-30', periodEnd: '2025-04-05', searchVolume: 100 },
        { periodStart: '2025-04-06', periodEnd: '2025-04-12', searchVolume: 220 }
      ]
    });
    expect(result.seasonal).toBe(true);
    expect(result.seasonalityIndex).toBeGreaterThan(0.4);
    expect(result.consistency).not.toBeNull();
  });

  it('computes sales stability from daily series and leaves missing prices unknown', () => {
    const result = analyzeSalesEstimates({
      estimates: [
        { asin: 'B0A', estimatedMonthlySales: 1000, dailySales: [10, 11, 9, 10] },
        { asin: 'B0B', estimatedMonthlySales: 10, dailySales: [10, 11, 9, 10] }
      ]
    });
    expect(result.salesStability).toBeGreaterThan(0.8);
    expect(result.priceStability).toBeNull();
    expect(result.observedOrEstimated).toBe('estimated');
  });

  it('does not treat cross-ASIN monthly totals as temporal volatility', () => {
    const swapped = analyzeSalesEstimates({
      estimates: [
        { asin: 'B0A', estimatedMonthlySales: 10, dailySales: [10, 11, 9, 10] },
        { asin: 'B0B', estimatedMonthlySales: 1000, dailySales: [10, 11, 9, 10] }
      ]
    });
    const original = analyzeSalesEstimates({
      estimates: [
        { asin: 'B0A', estimatedMonthlySales: 1000, dailySales: [10, 11, 9, 10] },
        { asin: 'B0B', estimatedMonthlySales: 10, dailySales: [10, 11, 9, 10] }
      ]
    });
    expect(swapped.salesStability).toBe(original.salesStability);
  });

  it('leaves sales stability unknown without a daily series', () => {
    const result = analyzeSalesEstimates({
      estimates: [{ asin: 'B0A', estimatedMonthlySales: 500 }]
    });
    expect(result.salesStability).toBeNull();
    expect(result.priceStability).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('computes brand dominance from official brand-level Share of Voice rows', () => {
    const result = analyzeShareOfVoice({
      brands: [
        { brand: 'Zulay', share: 0.7 },
        { brand: 'Other', share: 0.3 }
      ]
    });
    expect(result.topBrand).toBe('Zulay');
    expect(result.brandDominance).toBe(0.7);
  });
});
