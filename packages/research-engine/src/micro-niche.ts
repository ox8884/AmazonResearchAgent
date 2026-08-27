import { classifyProductRelevance } from './relevance';
import type { ProductFamily } from './product-family';

export interface MicroNicheCluster {
  readonly name: string;
  readonly families: readonly ProductFamily[];
  readonly priceSegments: readonly PriceSegment[];
}

export interface PriceSegment {
  readonly label: string;
  readonly minPrice: number;
  readonly maxPrice: number;
  readonly familyCount: number;
}

const CLUSTER_RULES = [
  {
    name: 'Silicone Faucet Mat / Sink Splash Guard',
    terms: ['silicone', 'faucet mat', 'sink splash', 'sink mat']
  },
  {
    name: 'Diatomite / Stone Drying Tray',
    terms: ['diatomite', 'stone drying', 'drying tray']
  },
  {
    name: 'Acrylic Splash Guard',
    terms: ['acrylic']
  }
] as const;

function familyPrices(family: ProductFamily): number[] {
  return family.variants
    .map((variant) => variant.price)
    .filter((price): price is number => price !== null);
}

export function segmentPrices(families: readonly ProductFamily[]): PriceSegment[] {
  const prices = families
    .flatMap(familyPrices)
    .sort((left, right) => left - right);
  if (prices.length === 0) {
    return [];
  }
  const mid = Math.floor(prices.length / 2);
  const median = prices[mid];
  if (median === undefined || prices.length < 6) {
    const minPrice = prices[0] ?? 0;
    const maxPrice = prices[prices.length - 1] ?? minPrice;
    return [{ label: 'all', minPrice, maxPrice, familyCount: families.length }];
  }
  for (let index = 2; index < prices.length - 2; index += 1) {
    const current = prices[index];
    const next = prices[index + 1];
    if (current === undefined || next === undefined || current === 0) {
      continue;
    }
    if ((next - current) / current >= 0.4) {
      const lowCount = families.filter((family) =>
        familyPrices(family).some((price) => price <= current)
      ).length;
      const highCount = families.filter((family) =>
        familyPrices(family).some((price) => price >= next)
      ).length;
      if (lowCount >= 3 && highCount >= 3) {
        return [
          {
            label: 'value',
            minPrice: prices[0] ?? current,
            maxPrice: current,
            familyCount: lowCount
          },
          {
            label: 'premium',
            minPrice: next,
            maxPrice: prices[prices.length - 1] ?? next,
            familyCount: highCount
          }
        ];
      }
    }
  }
  return [
    {
      label: 'all',
      minPrice: prices[0] ?? 0,
      maxPrice: prices[prices.length - 1] ?? 0,
      familyCount: families.length
    }
  ];
}

export function clusterMicroNiches(
  families: readonly ProductFamily[],
  nicheName: string
): readonly MicroNicheCluster[] {
  const relevant = families.filter(
    (family) => classifyProductRelevance(nicheName, family).relevant
  );
  const clusters: MicroNicheCluster[] = [];
  const assigned = new Set<string>();

  for (const rule of CLUSTER_RULES) {
    const matched = relevant.filter((family) => {
      const title = family.variants.map((variant) => variant.title.toLocaleLowerCase('en-US')).join(' ');
      return rule.terms.some((term) => title.includes(term));
    });
    if (matched.length === 0) {
      continue;
    }
    for (const family of matched) {
      assigned.add(family.parentKey);
    }
    clusters.push({
      name: rule.name,
      families: matched,
      priceSegments: segmentPrices(matched)
    });
  }

  return clusters;
}
