import {
  LocaleSchema,
  type Locale
} from '@ara/shared';
import { z } from 'zod';

export const NORMALIZATION_PROMPT_VERSION = 'niche-normalization-v1' as const;

export const KeywordNormalizationSchema = z.object({
  classification: z.enum([
    'product_niche',
    'brand_ip',
    'broad_query',
    'typo_variant',
    'irrelevant',
    'ambiguous'
  ]),
  canonicalNiche: z.string().trim().min(1).nullable(),
  canonicalEnglish: z.string().trim().min(1).nullable(),
  catalogPhrases: z.array(z.string().trim().min(1)).max(8),
  aliases: z.array(z.string().trim().min(1)).max(20),
  productFit: z.enum(['strong', 'possible', 'poor']),
  riskFlags: z.array(
    z.enum([
      'food_contact',
      'electric',
      'battery',
      'fragile',
      'liquid',
      'heavy',
      'ip',
      'seasonal',
      'certification'
    ])
  ),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(800)
}).strict();
export type KeywordNormalization = z.infer<typeof KeywordNormalizationSchema>;

export function buildNormalizationPrompt(
  originalKeyword: string,
  locale: Locale
): string {
  const selectedLocale = LocaleSchema.parse(locale);
  return [
    'You classify one raw Amazon Opportunity Finder keyword for Kitchen & Dining.',
    `Original keyword data (preserve exactly): ${JSON.stringify(originalKeyword)}`,
    `Summary locale: ${selectedLocale}`,
    'Classify as product_niche, brand_ip, broad_query, typo_variant, irrelevant, or ambiguous.',
    'Normalize misspellings, plurals, synonyms, alternate-language phrases, and equivalent product phrases.',
    'Return likely Amazon catalog phrases for later Product Database validation.',
    'Do not invent a brand relationship; use brand_ip only when the phrase itself supports it.',
    'Return only the requested JSON object.'
  ].join('\n');
}
