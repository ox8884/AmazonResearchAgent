import { describe, expect, it } from 'vitest';
import { buildResearchObjects, scoreIsPreliminaryOnly } from './research-objects';
import type { CandidateSummary } from './server/dashboard-data';
import { summarizeCandidateEvidence } from './candidate-evidence';

function candidate(overrides: Partial<CandidateSummary> & { id: string }): CandidateSummary {
  return {
    keyword: 'batter dispenser',
    preliminary_score: null,
    rule_passed: false,
    rule_reasons: null,
    state: 'Discovered',
    evidence: { kind: 'unavailable' },
    ...overrides
  };
}

const SCHEMA_VALID_REASONS = [
  { code: 'PRICE_OUT_OF_RANGE', detail: 'Price outside the target band.' },
  { code: 'BROAD_SHOPPING_INTENT', detail: 'Keyword intent is too broad.' }
] as const;

describe('buildResearchObjects — lead record consistency', () => {
  it('keeps collected evidence bound to the lead instead of the first record', () => {
    const evidence = { kind: 'ready', completeness: 'complete', records: [], summary: summarizeCandidateEvidence([
      { kind: 'keyword_metrics', payload: { monthlySearchVolume: 311 } }
    ]) } as const;
    const objects = buildResearchObjects([
      candidate({ id: 'first', state: 'Discovered' }),
      candidate({ id: 'lead', state: 'Needs Review', evidence })
    ]);
    expect(objects[0]?.leadRecord.evidence).toEqual(evidence);
  });
  it('derives lead state and lead reason from the SAME lead record in mixed-state groups', () => {
    // records[0] is Ready (later tier) with a schema-valid reason;
    // records[1] is Waiting (earlier tier) with a different schema-valid reason.
    const objects = buildResearchObjects([
      candidate({
        id: 'ready-1',
        state: 'Ready for API Validation',
        preliminary_score: 80,
        rule_reasons: [SCHEMA_VALID_REASONS[0]]
      }),
      candidate({
        id: 'waiting-1',
        state: 'Waiting for AI Capacity',
        preliminary_score: 80,
        rule_reasons: [SCHEMA_VALID_REASONS[1]]
      })
    ]);
    expect(objects).toHaveLength(1);
    const object = objects[0]!;
    expect(object.mixedStates).toBe(true);
    // Lead record must be the Waiting record (earlier focus tier), and the
    // lead reason must come from that same record — not from records[0].
    expect(object.leadRecord.id).toBe('waiting-1');
    expect(object.leadState).toBe('Waiting for AI Capacity');
    expect(object.leadReason?.some((r) => r.code === 'BROAD_SHOPPING_INTENT')).toBe(true);
    expect(object.leadReason?.some((r) => r.code === 'PRICE_OUT_OF_RANGE')).toBe(false);
  });

  it('treats schema-invalid rule reasons as unrecorded rationale (fail-closed)', () => {
    // Real DB rows can carry operational codes outside RuleCodeSchema. The
    // shared contract rejects them; the object must not surface them as
    // recorded rationale.
    const objects = buildResearchObjects([
      candidate({
        id: 'a',
        state: 'Ready for API Validation',
        rule_reasons: [{ code: 'RULE_PASS', detail: 'rule accepted' }]
      })
    ]);
    expect(objects[0]!.leadReason).toBeNull();
    expect(objects[0]!.allRecordsLackRationale).toBe(true);
  });

  it('prefers higher preliminary score within the same state tier', () => {
    const objects = buildResearchObjects([
      candidate({ id: 'low', state: 'Ready for API Validation', preliminary_score: 60 }),
      candidate({ id: 'high', state: 'Ready for API Validation', preliminary_score: 90 })
    ]);
    expect(objects[0]!.leadRecord.id).toBe('high');
  });

  it('summarizes real per-state counts in focus-tier order', () => {
    const objects = buildResearchObjects([
      candidate({ id: 'a', state: 'Ready for API Validation' }),
      candidate({ id: 'b', state: 'Waiting for AI Capacity' }),
      candidate({ id: 'c', state: 'Ready for API Validation' }),
      candidate({ id: 'd', state: 'Waiting for AI Capacity' }),
      candidate({ id: 'e', state: 'Ready for API Validation' })
    ]);
    const object = objects[0]!;
    expect(object.stateBreakdown).toEqual([
      { state: 'Waiting for AI Capacity', count: 2 },
      { state: 'Ready for API Validation', count: 3 }
    ]);
  });

  it('does not merge different keywords', () => {
    const objects = buildResearchObjects([
      candidate({ id: 'x', keyword: 'Batter Dispenser' }),
      candidate({ id: 'y', keyword: 'batter dispenser' }),
      candidate({ id: 'z', keyword: 'batter dispensers' })
    ]);
    expect(objects).toHaveLength(2);
    expect(objects[0]!.records).toHaveLength(2);
  });

  it('keeps every original record reachable in the group', () => {
    const objects = buildResearchObjects([
      candidate({ id: 'r1' }),
      candidate({ id: 'r2' }),
      candidate({ id: 'r3' })
    ]);
    expect(objects[0]!.records.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('binds lead state, reason, and link target to the SAME record when records[0] is not the lead (mixed-state counterexample)', () => {
    // Counterexample: the incoming first record is a LATER-tier state with a
    // distinctive reason; the true lead is the earlier-tier Waiting record.
    // Every derived surface (state, reason, open-link id) must read from the
    // lead record — never from records[0].
    const objects = buildResearchObjects([
      candidate({
        id: 'first-ready',
        state: 'Ready for API Validation',
        preliminary_score: 99,
        rule_reasons: [SCHEMA_VALID_REASONS[0]]
      }),
      candidate({
        id: 'second-waiting',
        state: 'Waiting for AI Capacity',
        preliminary_score: 80,
        rule_reasons: [SCHEMA_VALID_REASONS[1]]
      })
    ]);
    const object = objects[0]!;
    expect(object.leadRecord.id).not.toBe(object.records[0]!.id);
    expect(object.leadRecord.id).toBe('second-waiting');
    // state and reason must both come from the lead record
    expect(object.leadState).toBe('Waiting for AI Capacity');
    expect(object.leadReason?.every((r) => SCHEMA_VALID_REASONS.some((s) => s.code === r.code && s.detail === r.detail)))
      .toBe(true);
    expect(object.leadReason?.some((r) => r.code === 'PRICE_OUT_OF_RANGE')).toBe(false);
    // the open-link target (what DecisionCall/FocusGroups render) must be the lead record id
    expect(object.leadRecord.id).toBe('second-waiting');
  });
});

describe('scoreIsPreliminaryOnly', () => {
  it('flags preliminary-only when no decided state exists', () => {
    const objects = buildResearchObjects([
      candidate({ id: 'a', state: 'Ready for API Validation', preliminary_score: 80 })
    ]);
    expect(scoreIsPreliminaryOnly(objects[0]!)).toBe(true);
  });

  it('does not flag when a record is decided', () => {
    const objects = buildResearchObjects([
      candidate({ id: 'a', state: 'Strong', preliminary_score: 90 })
    ]);
    expect(scoreIsPreliminaryOnly(objects[0]!)).toBe(false);
  });
});
