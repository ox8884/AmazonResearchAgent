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
        { month: '2026-01', searchVolume: 100 },
        { month: '2026-02', searchVolume: 110 }
      ]
    });
    expect(result.seasonalityIndex).toBeNull();
    expect(result.consistency).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('flags seasonal Historical Search Volume when range exceeds 40% of mean', () => {
    const result = analyzeHistoricalSearchVolume({
      points: [
        { month: '2025-03', searchVolume: 100 },
        { month: '2025-04', searchVolume: 100 },
        { month: '2025-05', searchVolume: 100 },
        { month: '2025-06', searchVolume: 100 },
        { month: '2025-07', searchVolume: 100 },
        { month: '2025-08', searchVolume: 220 }
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

  it('maps Share of Voice ASINs to brands instead of treating ASIN share as dominance', () => {
    const result = analyzeShareOfVoice({
      rows: [
        { asin: 'B0A', share: 0.4 },
        { asin: 'B0B', share: 0.3 },
        { asin: 'B0C', share: 0.3 }
      ],
      brandByAsin: { B0A: 'Zulay', B0B: 'Zulay', B0C: 'Other' }
    });
    expect(result.topBrand).toBe('Zulay');
    expect(result.brandDominance).toBe(0.7);
  });
});
