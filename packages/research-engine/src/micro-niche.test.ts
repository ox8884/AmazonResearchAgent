import { describe, expect, it } from 'vitest';
import { clusterMicroNiches } from './micro-niche';
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

