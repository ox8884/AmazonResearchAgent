import { RuleReasonSchema } from '@ara/shared';
import type { CandidateStateCounts, CandidateSummary } from './server/dashboard-data';

// Presentation groupings over the existing candidate state vocabulary. The
// buckets only rename recorded states for the briefing and the pipeline
// pulse; they never invent counts or rankings.
const DISCOVERY_STATES = ['Discovered', 'Rule Filter'] as const;
const VALIDATION_STATES = [
  'Ready for API Validation',
  'Waiting for API Budget',
  'API Validation Running'
] as const;
const SCREENING_STATES = ['AI Screening', 'Waiting for AI Capacity', 'Deep Research'] as const;
const DECIDED_STATES = ['Strong', 'Watch'] as const;
const REJECTED_STATES = ['Reject'] as const;
const REVIEW_STATES = ['Needs Review', 'Needs Attention'] as const;

// Focus-group tiers: an explicit ordering rule over recorded states only.
// 1 needs operator review, 2 blocked on capacity/budget, 3 actively moving,
// 4 ready/pre-evaluation, 5 decided.
const FOCUS_TIERS: readonly (readonly string[])[] = [
  ['Needs Review', 'Needs Attention'],
  ['Waiting for API Budget', 'Waiting for AI Capacity'],
  ['AI Screening', 'API Validation Running', 'Deep Research', 'Rule Filter'],
  ['Ready for API Validation', 'Discovered'],
  ['Strong', 'Watch', 'Reject']
];

export interface PipelineSummary {
  readonly discovery: number;
  readonly validation: number;
  readonly screening: number;
  readonly decided: number;
  readonly rejected: number;
  readonly review: number;
  readonly inProgress: number;
  readonly total: number;
  readonly waitingBudget: number;
  readonly waitingCapacity: number;
}

export interface FocusGroup {
  readonly state: string;
  readonly tier: number;
  /** True total of candidates in this state across the whole pipeline. */
  readonly total: number;
  /** Queued rows in this state, preliminary score order. */
  readonly rows: readonly CandidateSummary[];
  readonly allRowsLackRationale: boolean;
}

export interface Bottleneck {
  readonly kind: 'review' | 'budget-wait' | 'capacity-wait' | 'flowing' | 'none' | 'empty';
  readonly count: number;
}

function countStates(counts: CandidateStateCounts, states: readonly string[]): number {
  return states.reduce((sum, state) => sum + (counts[state] ?? 0), 0);
}

export function summarizeStateCounts(counts: CandidateStateCounts): PipelineSummary {
  const discovery = countStates(counts, DISCOVERY_STATES);
  const validation = countStates(counts, VALIDATION_STATES);
  const screening = countStates(counts, SCREENING_STATES);
  const decided = countStates(counts, DECIDED_STATES);
  const rejected = countStates(counts, REJECTED_STATES);
  const review = countStates(counts, REVIEW_STATES);
  return {
    discovery,
    validation,
    screening,
    decided,
    rejected,
    review,
    inProgress: validation + screening,
    total: discovery + validation + screening + decided + rejected + review,
    waitingBudget: counts['Waiting for API Budget'] ?? 0,
    waitingCapacity: counts['Waiting for AI Capacity'] ?? 0
  };
}

function tierForState(state: string): number {
  const tier = FOCUS_TIERS.findIndex((states) => states.includes(state));
  return tier === -1 ? FOCUS_TIERS.length : tier;
}

/**
 * Groups queued candidates by their recorded state. Group order is explicit
 * and data-only: focus tier first, then larger group first, then state name.
 * Rows keep their incoming preliminary-score order.
 */
export function buildFocusGroups(
  candidates: readonly CandidateSummary[],
  stateCounts: CandidateStateCounts
): FocusGroup[] {
  const byState = new Map<string, CandidateSummary[]>();
  for (const candidate of candidates) {
    const state = candidate.state ?? 'unknown';
    const rows = byState.get(state);
    if (rows) rows.push(candidate);
    else byState.set(state, [candidate]);
  }
  const groups: FocusGroup[] = [];
  for (const [state, rows] of byState) {
    const allRowsLackRationale = rows.every((row) => {
      const parsed = RuleReasonSchema.array().safeParse(row.rule_reasons);
      return !parsed.success || parsed.data.length === 0;
    });
    groups.push({
      state,
      tier: tierForState(state),
      total: stateCounts[state] ?? rows.length,
      rows,
      allRowsLackRationale
    });
  }
  return groups.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
    return a.state.localeCompare(b.state);
  });
}

/**
 * The one pipeline state that currently blocks action, derived only from
 * recorded state counts and the budget record. No synthetic urgency.
 */
export function deriveBottleneck(
  summary: PipelineSummary,
  budget: { readonly hasRecord: boolean; readonly dailyLimit: number; readonly used: number }
): Bottleneck {
  if (summary.total === 0) return { kind: 'empty', count: 0 };
  if (summary.review > 0) return { kind: 'review', count: summary.review };
  const budgetExhausted =
    budget.hasRecord && (budget.dailyLimit === 0 || budget.used >= budget.dailyLimit);
  if (summary.waitingBudget > 0 && budgetExhausted) {
    return { kind: 'budget-wait', count: summary.waitingBudget };
  }
  if (summary.waitingCapacity > 0) return { kind: 'capacity-wait', count: summary.waitingCapacity };
  if (summary.inProgress > 0) return { kind: 'flowing', count: summary.inProgress };
  return { kind: 'none', count: summary.decided + summary.rejected };
}

export function formatCount(template: string, count: number): string {
  return template.replace('{count}', String(count));
}
