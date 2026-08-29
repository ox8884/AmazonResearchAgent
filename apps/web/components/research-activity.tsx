import { getCopy, type Locale } from '@ara/shared';
import type { JobCounts } from '../lib/server/dashboard-data';
import { MetricCard } from './ui';

export function ResearchActivity({
  locale,
  counts
}: {
  locale: Locale;
  counts: JobCounts;
}) {
  const copy = getCopy(locale);
  return (
    <section className="metric-grid" aria-label={copy.runsTitle}>
      <MetricCard label={copy.queuedLabel} value={counts.queued} />
      <MetricCard label={copy.runningLabel} value={counts.running} />
      <MetricCard label={copy.waitingLabel} value={counts.waiting} />
      <MetricCard label={copy.completedLabel} value={counts.completed} />
    </section>
  );
}
