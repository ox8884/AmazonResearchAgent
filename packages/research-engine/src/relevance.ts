import type { ProductFamily } from './product-family';

const IRRELEVANT_TERMS = [
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

export function classifyProductRelevance(
  _niche: string,
  family: ProductFamily
): RelevanceResult {
  const haystack = family.variants
    .map((variant) => variant.title.toLocaleLowerCase('en-US'))
    .join(' ');
  const hit = IRRELEVANT_TERMS.find((term) => haystack.includes(term));
  if (hit) {
    return {
      relevant: false,
      confidence: 0.95,
      reason: `Title matches excluded term: ${hit}`
    };
  }
  return {
    relevant: true,
    confidence: 0.7,
    reason: 'No lexical exclusion matched; treat as candidate-relevant.'
  };
}
