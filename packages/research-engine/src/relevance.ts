import type { ProductFamily } from './product-family';

const GENERIC_NOISE_TERMS = [
  'rug',
  'bath mat',
  'shower',
  'threshold strip',
  'cabinet liner',
  'under sink',
  'under-sink'
] as const;

export interface RelevanceResult {
  readonly relevant: boolean;
  readonly confidence: number;
  readonly reason: string;
}

function tokens(value: string): readonly string[] {
  return value
    .toLocaleLowerCase('en-US')
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 4);
}

export function classifyProductRelevance(
  niche: string,
  family: ProductFamily
): RelevanceResult {
  const haystack = family.variants
    .map((variant) => variant.title.toLocaleLowerCase('en-US'))
    .join(' ');
  const nicheText = niche.toLocaleLowerCase('en-US');
  const hit = GENERIC_NOISE_TERMS.find(
    (term) => haystack.includes(term) && !nicheText.includes(term)
  );
  if (hit) {
    return {
      relevant: false,
      confidence: 0.95,
      reason: `Title matches excluded term: ${hit}`
    };
  }
  const nicheTokens = tokens(niche);
  if (
    nicheTokens.length > 0 &&
    !nicheTokens.some((token) => haystack.includes(token))
  ) {
    return {
      relevant: false,
      confidence: 0.8,
      reason: 'Title shares no niche tokens.'
    };
  }
  return {
    relevant: true,
    confidence: 0.7,
    reason: 'No lexical exclusion matched; treat as candidate-relevant.'
  };
}
