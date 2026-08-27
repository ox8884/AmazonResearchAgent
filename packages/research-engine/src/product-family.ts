export interface CatalogProduct {
  readonly id: string;
  readonly title: string;
  readonly parentAsin: string | null;
  readonly unitsSold30: number | null;
  readonly revenue30: number | null;
  readonly price: number | null;
  readonly reviews: number | null;
  readonly rating: number | null;
  readonly brand: string | null;
  readonly weight: number | null;
  readonly updatedAt: string | null;
}

export interface ProductFamily {
  readonly parentKey: string;
  readonly variants: readonly CatalogProduct[];
  readonly observedMonthlyUnits: number;
  readonly observedMonthlyRevenue: number;
  readonly qualityNotes: readonly string[];
}

export function groupProductFamilies(
  products: readonly CatalogProduct[]
): readonly ProductFamily[] {
  const grouped = new Map<string, CatalogProduct[]>();
  for (const product of products) {
    const key = product.parentAsin ?? product.id;
    const existing = grouped.get(key) ?? [];
    existing.push(product);
    grouped.set(key, existing);
  }

  return [...grouped.entries()].map(([parentKey, variants]) => {
    const unitValues = variants
      .map((variant) => variant.unitsSold30)
      .filter((value): value is number => value !== null);
    const identicalUnits =
      unitValues.length > 1 && unitValues.every((value) => value === unitValues[0]);
    const observedMonthlyUnits = identicalUnits
      ? (unitValues[0] ?? 0)
      : unitValues.reduce((sum, value) => sum + value, 0);
    const revenueValues = variants
      .map((variant) => variant.revenue30)
      .filter((value): value is number => value !== null);
    const identicalRevenue =
      revenueValues.length > 1 && revenueValues.every((value) => value === revenueValues[0]);
    const observedMonthlyRevenue = identicalRevenue
      ? (revenueValues[0] ?? 0)
      : revenueValues.reduce((sum, value) => sum + value, 0);

    return {
      parentKey,
      variants,
      observedMonthlyUnits,
      observedMonthlyRevenue,
      qualityNotes: identicalUnits && variants.length > 1 ? ['VARIANT_SALES_DUPLICATED'] : []
    };
  });
}
