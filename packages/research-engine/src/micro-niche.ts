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

function familyMedianPrice(family: ProductFamily): number | null {
  const prices = family.variants
    .map((variant) => variant.price)
    .filter((price): price is number => price !== null)
    .sort((left, right) => left - right);
  if (prices.length === 0) {
    return null;
  }
  return prices[Math.floor(prices.length / 2)] ?? null;
}

export function segmentPrices(families: readonly ProductFamily[]): PriceSegment[] {
  const priced = families
    .map((family) => ({ family, median: familyMedianPrice(family) }))
    .filter((row): row is { family: ProductFamily; median: number } => row.median !== null)
    .sort((left, right) => left.median - right.median);
  if (priced.length === 0) {
    return [];
  }
  const minPrice = priced[0]?.median ?? 0;
  const maxPrice = priced[priced.length - 1]?.median ?? minPrice;
  if (priced.length < 6) {
    return [{ label: 'all', minPrice, maxPrice, familyCount: priced.length }];
  }
  for (let index = 2; index <= priced.length - 4; index += 1) {
    const current = priced[index]?.median;
    const next = priced[index + 1]?.median;
    if (current === undefined || next === undefined || current === 0) {
      continue;
    }
    if ((next - current) / current >= 0.4) {
      const low = priced.slice(0, index + 1);
      const high = priced.slice(index + 1);
      if (low.length >= 3 && high.length >= 3) {
        return [
          {
            label: 'value',
            minPrice: low[0]?.median ?? current,
            maxPrice: current,
            familyCount: low.length
          },
          {
            label: 'premium',
            minPrice: next,
            maxPrice: high[high.length - 1]?.median ?? next,
            familyCount: high.length
          }
        ];
      }
    }
  }
  return [{ label: 'all', minPrice, maxPrice, familyCount: priced.length }];
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
      const title = family.variants
        .map((variant) => variant.title.toLocaleLowerCase('en-US'))
        .join(' ');
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

  const leftover = relevant.filter((family) => !assigned.has(family.parentKey));
  if (leftover.length > 0) {
    clusters.push({
      name: nicheName,
      families: leftover,
      priceSegments: segmentPrices(leftover)
    });
  }

  return clusters;
}

