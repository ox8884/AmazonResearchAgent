import { describe, expect, it } from 'vitest';
import { groupProductFamilies, type CatalogProduct } from './product-family';

function variant(
  id: string,
  parent: string,
  units: number,
  title: string
): CatalogProduct {
  return {
    id,
    title,
    parentAsin: parent,
    unitsSold30: units,
    revenue30: units * 19.99,
    price: 19.99,
    reviews: 100,
    rating: 4.5,
    brand: 'Zulay',
    weight: 0.5,
    updatedAt: '2026-08-27T01:32:04Z'
  };
}

function zulayVariantFixture(): CatalogProduct[] {
  const parent = 'B0ZULAYPARENT';
  return [
    variant('B0CHILD1', parent, 200368, 'Zulay Milk Frother Black'),
    variant('B0CHILD2', parent, 200368, 'Zulay Milk Frother Red'),
    variant('B0CHILD3', parent, 200368, 'Zulay Milk Frother Blue'),
    variant('B0CHILD4', parent, 200368, 'Zulay Milk Frother Green'),
    variant('B0CHILD5', parent, 200368, 'Zulay Milk Frother White')
  ];
}

describe('product family dedupe', () => {
  // Break: variant rows with copied parent sales are summed as independent demand.
  it('does not sum identical parent-level sales repeated across variants', () => {
    const families = groupProductFamilies(zulayVariantFixture());
    const family = families[0];

    expect(families).toHaveLength(1);
    expect(family?.observedMonthlyUnits).toBe(200368);
    expect(family?.variants).toHaveLength(5);
    expect(family?.qualityNotes).toContain('VARIANT_SALES_DUPLICATED');
  });

  // Break: standalone products without parent_asin are dropped.
  it('uses the product ASIN when parent_asin is missing', () => {
    const families = groupProductFamilies([
      {
        id: 'B0STANDALONE',
        title: 'Standalone Sink Mat',
        parentAsin: null,
        unitsSold30: 80,
        revenue30: 1200,
        price: 15,
        reviews: 10,
        rating: 4,
        brand: 'Solo',
        weight: null,
        updatedAt: '2026-08-27T01:32:04Z'
      }
    ]);

    expect(families).toHaveLength(1);
    expect(families[0]?.parentKey).toBe('B0STANDALONE');
    expect(families[0]?.observedMonthlyUnits).toBe(80);
  });
});
