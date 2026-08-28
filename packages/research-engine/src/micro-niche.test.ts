import { describe, expect, it } from 'vitest';
import { clusterMicroNiches, segmentPrices } from './micro-niche';
import type { CatalogProduct, ProductFamily } from './product-family';
import { groupProductFamilies } from './product-family';

function product(id: string, title: string, price: number): CatalogProduct {
  return {
    id,
    title,
    parentAsin: id,
    unitsSold30: 100,
    revenue30: 100 * price,
    price,
    reviews: 40,
    rating: 4.2,
    brand: 'Brand',
    weight: 0.4,
    updatedAt: '2026-08-27T01:32:04Z'
  };
}

function families(items: CatalogProduct[]): readonly ProductFamily[] {
  return groupProductFamilies(items);
}

describe('micro-niche clustering', () => {
  // Break: rugs/bath mats stay in the sink niche, or faucet mats are dropped.
  it('keeps sink-adjacent mats and excludes rugs and bath products', () => {
    const result = clusterMicroNiches(
      families([
        product('B0SIL1', 'Silicone Faucet Mat Sink Splash Guard', 12.99),
        product('B0SIL2', 'Silicone Sink Mat for Faucet', 13.5),
        product('B0STONE', 'Diatomite Stone Drying Tray', 18),
        product('B0ACRY', 'Acrylic Splash Guard for Sink', 22),
        product('B0RUG', 'Kitchen Rug Runner', 25),
        product('B0BATH', 'Bath Mat Absorbent', 16),
        product('B0SHOWER', 'Shower Threshold Strip', 19),
        product('B0LINER', 'Under-sink Cabinet Liner', 11)
      ]),
      'sink drip tray'
    );

    expect(result.map((cluster) => cluster.name)).toEqual(
      expect.arrayContaining([
        'Silicone Faucet Mat / Sink Splash Guard',
        'Diatomite / Stone Drying Tray',
        'Acrylic Splash Guard'
      ])
    );
    const titles = result.flatMap((cluster) =>
      cluster.families.flatMap((family) => family.variants.map((variant) => variant.title))
    );
    expect(titles.join(' ')).not.toMatch(/Rug|Bath Mat|Shower|Cabinet Liner/i);
  });

  it('keeps a non-sink niche together instead of forcing sink cluster names', () => {
    const result = clusterMicroNiches(
      families([
        product('B0CUP1', 'Stainless Milk Frother Whisk', 14.99),
        product('B0CUP2', 'Electric Milk Frother Handheld', 19.99)
      ]),
      'milk frother'
    );
    expect(result.map((cluster) => cluster.name)).toEqual(['milk frother']);
    expect(result[0]?.families).toHaveLength(2);
  });
});

describe('family-median price segmentation', () => {
  it('does not let a variant-heavy family overweight a price band', () => {
    const cheap = families([
      product('B0A', 'A', 10),
      product('B0B', 'B', 11),
      product('B0C', 'C', 12)
    ]);
    const expensive = families([
      product('B0D', 'D', 20),
      product('B0E', 'E', 21),
      product('B0F', 'F', 22)
    ]);
    const heavy = groupProductFamilies([
      { ...product('B0G1', 'G1', 10), parentAsin: 'B0G' },
      { ...product('B0G2', 'G2', 10.5), parentAsin: 'B0G' },
      { ...product('B0G3', 'G3', 11), parentAsin: 'B0G' },
      { ...product('B0G4', 'G4', 30), parentAsin: 'B0G' }
    ]);
    const segments = segmentPrices([...cheap, ...expensive, ...heavy]);
    expect(segments.map((segment) => segment.familyCount)).toEqual([4, 3]);
  });

  it('splits only on a 40 percent family-median gap with three families per side', () => {
    const value = [10, 11, 12].map((price, index) =>
      product(`B0L${index}`, `Low ${index}`, price)
    );
    const premium = [20, 21, 22].map((price, index) =>
      product(`B0H${index}`, `High ${index}`, price)
    );
    const split = segmentPrices(families([...value, ...premium]));
    expect(split.map((segment) => segment.label)).toEqual(['value', 'premium']);
    expect(split[0]?.familyCount).toBe(3);
    expect(split[1]?.familyCount).toBe(3);
    const tight = segmentPrices(
      families([10, 11, 12, 13, 14, 15].map((price, index) => product(`B0T${index}`, `T${index}`, price)))
    );
    expect(tight).toHaveLength(1);
  });

  it('excludes families with missing prices from segmentation', () => {
    const priced = families([
      product('B0A', 'A', 10),
      product('B0B', 'B', 11),
      product('B0C', 'C', 12)
    ]);
    const missing = groupProductFamilies([
      { ...product('B0Z', 'Z', 0), price: null }
    ]);
    const segments = segmentPrices([...priced, ...missing]);
    expect(segments[0]?.familyCount).toBe(3);
  });
});


