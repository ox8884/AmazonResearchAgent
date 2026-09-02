import { getCopy, type Locale } from '@ara/shared';
import { formatCount, type PipelineSummary } from '../lib/dashboard-metrics';
import type { ApiBudgetMeter, JobCounts } from '../lib/server/dashboard-data';

export function ResearchPulse({
  locale,
  counts,
  budget,
  summary,
  importsTotal,
  ready
}: {
  locale: Locale;
  counts: JobCounts;
  budget: ApiBudgetMeter;
  summary: PipelineSummary;
  importsTotal: number;
  ready: boolean;
}) {
  const copy = getCopy(locale);
  const jobsTotal = counts.queued + counts.running + counts.failed + counts.completed;
  const remaining =
    budget.dailyLimit > 0 ? Math.max(0, budget.dailyLimit - budget.used) : 0;
  const budgetBlocked =
    budget.hasRecord &&
    summary.waitingBudget > 0 &&
    (budget.dailyLimit === 0 || budget.used >= budget.dailyLimit);

  return (
    <section className="panel panel--inset pulse" aria-labelledby="pulse-title">
      <div className="section-heading">
        <h2 id="pulse-title">{copy.pulseTitle}</h2>
      </div>
      {!ready ? (
        <p className="pulse__status">{copy.statusUnavailable}</p>
      ) : summary.total === 0 ? (
        <p className="pulse__status">{copy.pulseEmpty}</p>
      ) : (
        <>
          <p className="pulse__unit-note">{copy.pulseUnitNote}</p>
          <ol className="pulse__stages">
            <li>
              <span className="pulse__stage-label">{copy.pulseStageImports}</span>
              <strong className="pulse__stage-count">{importsTotal}</strong>
            </li>
            <li>
              <span className="pulse__stage-label">{copy.pulseStageDiscovery}</span>
              <strong className="pulse__stage-count">{summary.discovery}</strong>
            </li>
            <li>
              <span className="pulse__stage-label">{copy.pulseStageValidation}</span>
              <strong className="pulse__stage-count">{summary.validation}</strong>
            </li>
            <li>
              <span className="pulse__stage-label">{copy.stateAiScreening}</span>
              <strong className="pulse__stage-count">{summary.screening}</strong>
            </li>
            <li>
              <span className="pulse__stage-label">{copy.pulseStageDecided}</span>
              <strong className="pulse__stage-count">{summary.decided}</strong>
            </li>
            <li>
              <span className="pulse__stage-label">{copy.stateReject}</span>
              <strong className="pulse__stage-count">{summary.rejected}</strong>
            </li>
          </ol>
        </>
      )}
      {ready && summary.review > 0 ? (
        <p className="pulse__review">{copy.pulseNeedsReview}: {summary.review}</p>
      ) : null}
      <div className="pulse__group">
        <h3>{copy.jobsTitle}</h3>
        {!ready ? (
          <p className="pulse__note">{copy.statusUnavailable}</p>
        ) : jobsTotal === 0 ? (
          <p className="pulse__note">{copy.jobsZero}</p>
        ) : (
          <ul className="pulse__counts">
            <li>
              <span>{copy.queuedLabel}</span>
              <strong>{counts.queued}</strong>
            </li>
            <li>
              <span>{copy.runningLabel}</span>
              <strong>{counts.running}</strong>
            </li>
            <li>
              <span>{copy.failedLabel}</span>
              <strong>{counts.failed}</strong>
            </li>
            <li>
              <span>{copy.completedLabel}</span>
              <strong>{counts.completed}</strong>
            </li>
          </ul>
        )}
      </div>
      <div className="pulse__group">
        <h3>{copy.apiBudgetLabel}</h3>
        {!ready ? (
          <p className="pulse__note">{copy.statusUnavailable}</p>
        ) : !budget.hasRecord ? (
          <p className="pulse__note">{copy.budgetNoRecord}</p>
        ) : budgetBlocked ? (
          <>
            <p className="pulse__budget-alert">
              {formatCount(copy.budgetBlocked, summary.waitingBudget)}
            </p>
            <p className="pulse__budget-detail">{budget.used}/{budget.dailyLimit}</p>
          </>
        ) : budget.dailyLimit === 0 ? (
          <p className="pulse__note">{copy.budgetZero}</p>
        ) : (
          <>
            <p className="pulse__budget-value">{budget.used}/{budget.dailyLimit}</p>
            <p className="pulse__budget-detail">
              {copy.budgetRemainingLabel} {remaining}
              {budget.reservedLimit > 0
                ? ` · ${copy.reserveLabel} ${budget.reservedLimit}`
                : ''}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
