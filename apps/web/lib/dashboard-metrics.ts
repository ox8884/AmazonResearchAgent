import type { CandidateStateCounts } from './server/dashboard-data';

// Presentation groupings over the existing candidate state vocabulary. The
// buckets only rename recorded states for the briefing and the pipeline pulse;
// they never invent counts or rankings.
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
    waitingBudget: counts['Waiting for API Budget'] ?? 0
  };
}

export function formatCount(template: string, count: number): string {
  return template.replace('{count}', String(count));
}
