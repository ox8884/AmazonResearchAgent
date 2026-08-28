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

  it('computes sales stability from monthly estimates and leaves missing prices unknown', () => {
    const result = analyzeSalesEstimates({
      monthlySales: [100, 110, 90, 100]
    });
    expect(result.salesStability).toBeGreaterThan(0.8);
    expect(result.priceStability).toBeNull();
    expect(result.observedOrEstimated).toBe('estimated');
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
