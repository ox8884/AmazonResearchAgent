import { getCopy, type Locale } from '@ara/shared';
import type { ReactNode } from 'react';
import {
  deriveBottleneck,
  formatCount,
  type PipelineSummary
} from '../lib/dashboard-metrics';
import type { ApiBudgetMeter, JobCounts } from '../lib/server/dashboard-data';

function budgetIsBlocking(budget: ApiBudgetMeter, waitingBudget: number): boolean {
  return (
    budget.hasRecord &&
    waitingBudget > 0 &&
    (budget.dailyLimit === 0 || budget.used >= budget.dailyLimit)
  );
}

export function PipelineSignal({
  locale,
  summary,
  budget,
  counts,
  importsTotal,
  ready
}: {
  locale: Locale;
  summary: PipelineSummary;
  budget: ApiBudgetMeter;
  counts: JobCounts;
  importsTotal: number;
  ready: boolean;
}) {
  const copy = getCopy(locale);
  const bottleneck = deriveBottleneck(summary, budget);
  const jobsTotal = counts.queued + counts.running + counts.failed + counts.completed;
  const budgetBlocking = budgetIsBlocking(budget, summary.waitingBudget);
  const remaining =
    budget.dailyLimit > 0 ? Math.max(0, budget.dailyLimit - budget.used) : 0;

  let headline: ReactNode;
  let headlineTone: 'calm' | 'blocked' = 'calm';
  if (!ready) {
    headline = <span className="pipeline-signal__status">{copy.statusUnavailable}</span>;
  } else if (bottleneck.kind === 'empty') {
    headline = <span>{copy.pulseEmpty}</span>;
  } else if (bottleneck.kind === 'review') {
    headline = (
      <>
        <strong>{copy.needsAttentionLabel}</strong>
        <span className="pipeline-signal__numeral">{bottleneck.count}</span>
      </>
    );
    headlineTone = 'blocked';
  } else if (bottleneck.kind === 'budget-wait') {
    headline = (
      <>
        <strong>{copy.stateWaitingForApiBudget}</strong>
        <span className="pipeline-signal__numeral">{bottleneck.count}</span>
      </>
    );
    headlineTone = 'blocked';
  } else if (bottleneck.kind === 'capacity-wait') {
    headline = (
      <>
        <strong>{copy.stateWaitingForAiCapacity}</strong>
        <span className="pipeline-signal__numeral">{bottleneck.count}</span>
      </>
    );
    headlineTone = 'blocked';
  } else if (bottleneck.kind === 'flowing') {
    headline = <span>{formatCount(copy.bottleneckFlowing, bottleneck.count)}</span>;
  } else {
    headline = <span>{copy.bottleneckNone}</span>;
  }

  const stages: readonly (readonly [string, number])[] = [
    [copy.pulseStageImports, importsTotal],
    [copy.pulseStageDiscovery, summary.discovery],
    [copy.pulseStageValidation, summary.validation],
    [copy.stateAiScreening, summary.screening],
    [copy.pulseStageDecided, summary.decided],
    [copy.stateReject, summary.rejected]
  ];

  return (
    <section className="panel panel--inset pipeline-signal" aria-labelledby="pipeline-signal-title">
      <div className="section-heading">
        <h2 id="pipeline-signal-title">{copy.bottleneckTitle}</h2>
      </div>
      <p className={`pipeline-signal__headline pipeline-signal__headline--${headlineTone}`}>
        {headline}
      </p>
      {ready && summary.total > 0 ? (
        <p className="pipeline-signal__path" aria-label={copy.pipelinePathLabel}>
          {stages.map(([label, count], index) => (
            <span className="pipeline-signal__stage" key={label}>
              {index > 0 ? <span aria-hidden="true">· </span> : null}
              {label} <strong>{count}</strong>
            </span>
          ))}
        </p>
      ) : null}
      <div className="pipeline-signal__ops">
        {ready ? (
          jobsTotal === 0 ? (
            <span>{copy.jobsZero}</span>
          ) : (
            <span>
              {copy.jobsTitle}: {copy.queuedLabel} {counts.queued} · {copy.runningLabel}{' '}
              {counts.running} · {copy.completedLabel} {counts.completed}
            </span>
          )
        ) : null}
        {ready ? (
          !budget.hasRecord ? (
            <span>{copy.apiBudgetLabel}: {copy.budgetNoRecord}</span>
          ) : budgetBlocking ? (
            <span className="pipeline-signal__ops-alert">
              {formatCount(copy.budgetBlocked, summary.waitingBudget)}
            </span>
          ) : budget.dailyLimit === 0 ? (
            <span>{copy.apiBudgetLabel}: {copy.budgetZero}</span>
          ) : (
            <span>
              {copy.apiBudgetLabel} {budget.used}/{budget.dailyLimit} ·{' '}
              {copy.budgetRemainingLabel} {remaining}
            </span>
          )
        ) : null}
      </div>
    </section>
  );
}
