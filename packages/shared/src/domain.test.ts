import { describe, expect, it } from 'vitest';
import { COPY, DEFAULT_LOCALE } from './i18n';
import {
  CandidateStateSchema,
  ImportOpportunityCsvJobPayloadSchema,
  ImportRunStatusSchema,
  LocaleSchema,
  OpportunityCsvRowSchema,
  PreliminaryCandidateSchema,
  RuleCodeSchema
} from './domain';

describe('domain schemas', () => {
  // Break: an unsupported locale is accepted by the product contract.
  it('allows only Korean and English locales', () => {
    expect(LocaleSchema.parse('ko')).toBe('ko');
    expect(LocaleSchema.parse('en')).toBe('en');
    expect(() => LocaleSchema.parse('ja')).toThrow();
  });

  // Break: a regular numeric search volume cannot enter the canonical row model.
  it('accepts a parsed Opportunity Finder row and canonicalizes exact search volume', () => {
    const row = OpportunityCsvRowSchema.parse({
      keyword: 'pancake dispenser bottle',
      nicheScore: 9,
      monthlyUnits: 1845,
      averagePrice: 17.73,
      searchVolume: 1601,
      trend30: 6,
      trend90: 26,
      competition: 'Very Low',
      seasonality: 'Very Low',
      lastUpdated: '2026-08-26'
    });

    expect(row.keyword).toBe('pancake dispenser bottle');
    expect(row.searchVolume).toEqual({ value: 1601, isUpperBound: false });
  });

  // Break: the less-than marker is discarded and 450 is represented as an exact count.
  it('preserves upper-bound search volume meaning', () => {
    const row = OpportunityCsvRowSchema.parse({
      keyword: 'compact utensil holder',
      nicheScore: 7,
      monthlyUnits: 920,
      averagePrice: 24.5,
      searchVolume: { value: 450, isUpperBound: true },
      trend30: -3,
      trend90: 4,
      competition: 'Low',
      seasonality: 'Low',
      lastUpdated: '2026-08-26'
    });

    expect(row.searchVolume).toEqual({ value: 450, isUpperBound: true });
  });

  // Break: audit records can contain a reason code the rule engine does not understand.
  it('rejects unknown deterministic rule codes', () => {
    expect(RuleCodeSchema.parse('PRICE_OUT_OF_RANGE')).toBe('PRICE_OUT_OF_RANGE');
    expect(() => RuleCodeSchema.parse('UNKNOWN_RULE')).toThrow();
  });

  // Break: Plan 01 persists an import status outside its durable state machine.
  it('limits import runs to durable Plan 01 statuses', () => {
    expect(ImportRunStatusSchema.parse('queued')).toBe('queued');
    expect(() => ImportRunStatusSchema.parse('uploading')).toThrow();
  });

  // Break: a deferred sourcing state leaks into the Plan 01 candidate lifecycle.
  it('limits candidates to the approved research states', () => {
    expect(CandidateStateSchema.parse('Waiting for API Budget')).toBe('Waiting for API Budget');
    expect(() => CandidateStateSchema.parse('Sample Ordered')).toThrow();
  });

  // Break: an invalid preliminary score can be persisted as a dashboard candidate.
  it('validates a preliminary candidate score and audit reasons', () => {
    const candidate = PreliminaryCandidateSchema.parse({
      keyword: 'pancake dispenser bottle',
      state: 'AI Screening',
      preliminaryScore: 81.5,
      eligibleForAiNormalization: true,
      ruleReasons: [],
      flags: []
    });

    expect(candidate.preliminaryScore).toBe(81.5);
    expect(() =>
      PreliminaryCandidateSchema.parse({ ...candidate, preliminaryScore: 101 })
    ).toThrow();
  });

  // Break: import jobs accept inline bytes, path traversal, or unverified Storage objects.
  it('accepts only hashed private Storage file references', () => {
    const payload = {
      importRunId: '7a985480-7a5d-4ef1-9648-2f443468e2fe',
      storageBucket: 'opportunity-imports',
      files: [
        {
          sourceFileName: 'page-1.csv',
          storagePath: '7a985480/page-1.csv',
          contentSha256: 'a'.repeat(64)
        }
      ]
    };

    expect(ImportOpportunityCsvJobPayloadSchema.parse(payload)).toEqual(payload);
    expect(() =>
      ImportOpportunityCsvJobPayloadSchema.parse({
        ...payload,
        files: [{ ...payload.files[0], storagePath: '../page-1.csv' }]
      })
    ).toThrow();
  });
});

describe('bilingual copy contract', () => {
  // Break: the application starts in English instead of the approved Korean default.
  it('defaults to Korean', () => {
    expect(DEFAULT_LOCALE).toBe('ko');
  });

  // Break: a UI key exists in one locale but is missing from the other.
  it('keeps Korean and English copy keys aligned', () => {
    expect(Object.keys(COPY.ko).sort()).toEqual(Object.keys(COPY.en).sort());
  });
});
