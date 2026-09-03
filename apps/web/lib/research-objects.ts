import { RuleReasonSchema, type RuleReason } from '@ara/shared';
import type { CandidateSummary } from './server/dashboard-data';

/**
 * Display-only grouping of candidate records into "research objects".
 *
 * Two records share a research object only when their keywords are equal
 * after trimming and lower-casing (ASCII case fold only). No stemming,
 * synonyms, or fuzzy dedupe: if the recorded keywords differ at all, they
 * stay separate objects. No database record is merged, deleted, or
 * rewritten — this grouping exists only for presentation.
 */
export function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

export interface CandidateRecordRef {
  readonly id: string;
  readonly keyword: string;
  readonly state: string | null;
  readonly preliminaryScore: number | null;
  readonly rulePassed: boolean | null;
  readonly ruleReasons: unknown;
}

export interface StateBreakdownEntry {
  readonly state: string;
  readonly count: number;
}

export interface ResearchObject {
  /** Display keyword: the first record's original (untrimmed) keyword. */
  readonly keyword: string;
  /** Normalized grouping key. */
  readonly key: string;
  /** All original records, in their incoming order. */
  readonly records: readonly CandidateRecordRef[];
  /**
   * The one record every derived surface (lead state, lead reason, focal
   * link) reads from. Chosen deterministically from recorded values only:
   * earliest focus tier, then higher preliminary score, then incoming
   * order. Every derived field of the object comes from this record, so a
   * collapsed object can never show state and reason from two different
   * records.
   */
  readonly leadRecord: CandidateRecordRef;
  /** State of the lead record. */
  readonly leadState: string | null;
  /** Parsed recorded reasons of the lead record. */
  readonly leadReason: readonly RuleReason[] | null;
  /** Recorded states across ALL records with real counts, focus-tier order. */
  readonly stateBreakdown: readonly StateBreakdownEntry[];
  /** True when records disagree on state (collapsed view shows breakdown). */
  readonly mixedStates: boolean;
  /** Preliminary scores recorded across the group's records. */
  readonly scores: readonly number[];
  /** Whether every record lacks a parsed rule reason. */
  readonly allRecordsLackRationale: boolean;
}

const STATE_TIERS: readonly (readonly string[])[] = [
  ['Needs Review', 'Needs Attention'],
  ['Waiting for API Budget', 'Waiting for AI Capacity'],
  ['AI Screening', 'API Validation Running', 'Deep Research', 'Rule Filter'],
  ['Ready for API Validation', 'Discovered'],
  ['Strong', 'Watch', 'Reject']
];

function stateTier(state: string): number {
  const tier = STATE_TIERS.findIndex((states) => states.includes(state));
  return tier === -1 ? STATE_TIERS.length : tier;
}

function firstReason(ruleReasons: unknown) {
  const parsed = RuleReasonSchema.array().safeParse(ruleReasons);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

/**
 * Build research objects from candidate records, preserving the incoming
 * order of first appearance. Used by the Candidates page (and mirrors the
 * dashboard's focus groups so both surfaces read the same object).
 */
export function buildResearchObjects(
  candidates: readonly CandidateSummary[]
): ResearchObject[] {
  const byKey = new Map<string, ResearchObject>();
  for (const candidate of candidates) {
    const keyword = candidate.keyword ?? '';
    const key = normalizeKeyword(keyword);
    const record: CandidateRecordRef = {
      id: candidate.id,
      keyword,
      state: candidate.state ?? null,
      preliminaryScore: candidate.preliminary_score ?? null,
      rulePassed: candidate.rule_passed ?? null,
      ruleReasons: candidate.rule_reasons
    };
    const existing = byKey.get(key);
    if (existing) {
      (existing.records as CandidateRecordRef[]).push(record);
    } else {
      byKey.set(key, {
        keyword,
        key,
        records: [record],
        leadRecord: record,
        leadState: null,
        leadReason: null,
        stateBreakdown: [],
        mixedStates: false,
        scores: [],
        allRecordsLackRationale: false
      });
    }
  }

  return Array.from(byKey.values(), (object) => {
    const records = object.records;
    // Deterministic lead record: earliest focus tier among recorded states,
    // then higher preliminary score, then incoming order. Derived only from
    // existing recorded values — no new priority vocabulary.
    const leadRecord = records
      .map((record, index) => ({ record, index }))
      .sort((a, b) => {
        const tierA = a.record.state ? stateTier(a.record.state) : STATE_TIERS.length;
        const tierB = b.record.state ? stateTier(b.record.state) : STATE_TIERS.length;
        if (tierA !== tierB) return tierA - tierB;
        const scoreA = a.record.preliminaryScore ?? -1;
        const scoreB = b.record.preliminaryScore ?? -1;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return a.index - b.index;
      })[0]!.record;
    // Real state counts from ALL original records, ordered by focus tier.
    const counts = new Map<string, number>();
    for (const record of records) {
      if (record.state === null) continue;
      counts.set(record.state, (counts.get(record.state) ?? 0) + 1);
    }
    const stateBreakdown = Array.from(counts.entries())
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => stateTier(a.state) - stateTier(b.state) || a.state.localeCompare(b.state));
    return {
      ...object,
      leadRecord,
      leadState: leadRecord.state,
      leadReason: firstReason(leadRecord.ruleReasons),
      stateBreakdown,
      mixedStates: stateBreakdown.length > 1,
      scores: records
        .map((record) => record.preliminaryScore)
        .filter((score): score is number => score !== null),
      allRecordsLackRationale: records.every((record) => firstReason(record.ruleReasons) === null)
    };
  });
}

/**
 * True when a preliminary score must not be presented as a verdict: the
 * object has a score but no recorded evidence beyond screening reasons
 * (no collected evidence payload, no decided state).
 */
export function scoreIsPreliminaryOnly(object: ResearchObject): boolean {
  if (object.scores.length === 0) return false;
  const decided = object.records.some(
    (record) => record.state === 'Strong' || record.state === 'Watch' || record.state === 'Reject'
  );
  return !decided;
}
