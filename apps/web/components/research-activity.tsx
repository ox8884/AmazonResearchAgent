import { getCopy, type Locale } from '@ara/shared';
import type { JobCounts } from '../lib/server/dashboard-data';

export function ResearchActivity({
  locale,
  counts
}: {
  locale: Locale;
  counts: JobCounts;
}) {
  const copy = getCopy(locale);
  return (
    <div className="operations-stats" aria-label={copy.runsTitle}>
      <div className="stat-row">
        <span><strong>{counts.queued}</strong>{copy.queuedLabel}</span>
        <span><strong>{counts.running}</strong>{copy.runningLabel}</span>
        <span><strong>{counts.waiting}</strong>{copy.waitingLabel}</span>
        <span><strong>{counts.completed}</strong>{copy.completedLabel}</span>
      </div>
    </div>
  );
}
