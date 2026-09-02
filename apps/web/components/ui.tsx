import {
  getCopy,
  ImportRunStatusSchema,
  type CopyKey,
  type ImportRunStatus,
  type Locale
} from '@ara/shared';
import type { ReactNode } from 'react';

export function ButtonLink({
  href,
  children,
  variant = 'primary'
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <a className={`button button--${variant}`} href={href}>
      {children}
    </a>
  );
}

export function StatusBadge({
  status,
  label
}: {
  status: ImportRunStatus;
  label: string;
}) {
  return <span className={`status status--${status}`}>{label}</span>;
}

export function LocalizedStatusBadge({
  status,
  locale
}: {
  status: string;
  locale: Locale;
}) {
  const parsedStatus = ImportRunStatusSchema.parse(status);
  const copy = getCopy(locale);
  const label = {
    queued: copy.importQueued,
    processing: copy.importProcessing,
    completed: copy.importCompleted,
    failed: copy.importFailed
  }[parsedStatus];
  return <StatusBadge status={parsedStatus} label={label} />;
}

const candidateStateLabels: Readonly<Record<string, CopyKey>> = {
  Discovered: 'stateDiscovered',
  'Rule Filter': 'stateRuleFilter',
  'AI Screening': 'stateAiScreening',
  'Ready for API Validation': 'stateReadyForApiValidation',
  'Waiting for API Budget': 'stateWaitingForApiBudget',
  'API Validation Running': 'stateApiValidationRunning',
  'Deep Research': 'stateDeepResearch',
  Strong: 'stateStrong',
  Watch: 'stateWatch',
  Reject: 'stateReject',
  'Needs Review': 'stateNeedsReview',
  'Waiting for AI Capacity': 'stateWaitingForAiCapacity',
  'Needs Attention': 'stateNeedsAttention'
};

function toneForState(value: string): 'neutral' | 'accent' | 'waiting' | 'strong' | 'reject' {
  if (value === 'Strong' || value === 'completed') return 'strong';
  if (value === 'Reject' || value === 'failed') return 'reject';
  if (
    value === 'Watch' ||
    value === 'Waiting for API Budget' ||
    value === 'Waiting for AI Capacity' ||
    value === 'Needs Attention' ||
    value === 'waiting' ||
    value === 'needs_attention'
  ) {
    return 'waiting';
  }
  if (
    value === 'AI Screening' ||
    value === 'API Validation Running' ||
    value === 'Deep Research' ||
    value === 'planning' ||
    value === 'fanout' ||
    value === 'running'
  ) {
    return 'accent';
  }
  return 'neutral';
}

export function ToneBadge({ value, label }: { value: string; label: string }) {
  return (
    <span className={`status status--tone-${toneForState(value)}`}>
      <span aria-hidden="true" className="status__marker" />
      {label}
    </span>
  );
}

export function CandidateStateBadge({ state, locale }: { state: string; locale: Locale }) {
  const copy = getCopy(locale);
  const labelKey = candidateStateLabels[state];
  return <ToneBadge value={state} label={labelKey ? copy[labelKey] : state} />;
}

const runStatusLabels: Readonly<Record<string, CopyKey>> = {
  queued: 'queuedLabel',
  planning: 'runPlanningLabel',
  fanout: 'runFanoutLabel',
  running: 'runningLabel',
  waiting: 'waitingLabel',
  completed: 'completedLabel',
  failed: 'failedLabel',
  needs_attention: 'needsAttentionLabel'
};

export function RunStatusBadge({ status, locale }: { status: string; locale: Locale }) {
  const copy = getCopy(locale);
  const labelKey = runStatusLabels[status];
  return <ToneBadge value={status} label={labelKey ? copy[labelKey] : status} />;
}

export function MetricCard({
  label,
  value,
  note
}: {
  label: string;
  value: number | string;
  note?: string;
}) {
  return (
    <article className="metric-card">
      <p className="metric-card__label">{label}</p>
      <p className="metric-card__value">{value}</p>
      {note ? <p className="metric-card__note">{note}</p> : null}
    </article>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

export function localeDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}
