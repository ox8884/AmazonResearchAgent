import { describe, expect, it } from 'vitest';
import {
  buildNormalizationPrompt,
  KeywordNormalizationSchema
} from './normalization-schema';

const dispenserKeywords = [
  'pancake dispenser bottle',
  'batter squeeze bottle',
  'batter mixer and dispenser'
] as const;

describe('keyword normalization output', () => {
  it('accepts the known batter dispenser fixture as one canonical niche', () => {
    const outputs = dispenserKeywords.map((keyword) =>
      KeywordNormalizationSchema.parse({
        classification: 'product_niche',
        canonicalNiche: 'Batter / Pancake Dispenser',
        canonicalEnglish: 'Batter / Pancake Dispenser',
        catalogPhrases: ['pancake dispenser', 'batter dispenser bottle'],
        aliases: [keyword],
        productFit: 'strong',
        riskFlags: [],
        confidence: 0.94,
        reason: 'Equivalent product phrases describe one dispensing niche.'
      })
    );

    expect(new Set(outputs.map((output) => output.canonicalNiche))).toEqual(
      new Set(['Batter / Pancake Dispenser'])
    );
    expect(outputs.every((output) => output.aliases.length === 1)).toBe(true);
  });

  it('represents brand/IP rejection without inventing a canonical niche', () => {
    const output = KeywordNormalizationSchema.parse({
      classification: 'brand_ip',
      canonicalNiche: null,
      canonicalEnglish: null,
      catalogPhrases: [],
      aliases: ['pikachu lunch box'],
      productFit: 'poor',
      riskFlags: ['ip'],
      confidence: 0.99,
      reason: 'The phrase contains a known franchise term.'
    });

    expect(output.classification).toBe('brand_ip');
    expect(output.canonicalNiche).toBeNull();
    expect(output.riskFlags).toContain('ip');
  });

  it('builds a locale-aware prompt that preserves the raw keyword as data', () => {
    const prompt = buildNormalizationPrompt('Batter squeeze bottle', 'ko');

    expect(prompt).toContain('Batter squeeze bottle');
    expect(prompt).toContain('ko');
    expect(prompt).toContain('catalog');
    expect(prompt).toContain('Do not invent a brand relationship');
  });

  it('rejects invalid classifications, confidence, and oversized output', () => {
    expect(() =>
      KeywordNormalizationSchema.parse({
        classification: 'maybe',
        canonicalNiche: null,
        canonicalEnglish: null,
        catalogPhrases: [],
        aliases: [],
        productFit: 'possible',
        riskFlags: [],
        confidence: 1.2,
        reason: 'invalid'
      })
    ).toThrow();
  });

  it('rejects unknown fields instead of stripping them', () => {
    expect(() =>
      KeywordNormalizationSchema.parse({
        classification: 'product_niche',
        canonicalNiche: 'Batter / Pancake Dispenser',
        canonicalEnglish: 'Batter / Pancake Dispenser',
        catalogPhrases: ['pancake dispenser'],
        aliases: ['batter squeeze bottle'],
        productFit: 'strong',
        riskFlags: [],
        confidence: 0.94,
        reason: 'Equivalent product phrases describe one dispensing niche.',
        classificaton: 'product_niche'
      })
    ).toThrow();
  });
});
