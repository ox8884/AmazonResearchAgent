import { getCopy } from '@ara/shared';
import { DecisionQueue } from '../../components/decision-queue';
import { ResearchPulse } from '../../components/research-pulse';
import { ResearchNowButton } from '../../components/research-now-button';
import {
  ButtonLink,
  LocalizedStatusBadge,
  localeDate
} from '../../components/ui';
import { localizedHref, parseLocale } from '../../lib/locale';
import { formatCount, summarizeStateCounts } from '../../lib/dashboard-metrics';
import {
  getApiBudgetMeterView,
  getCandidateStateCountsView,
  getDashboardView,
  getJobCountsView
} from '../../lib/server/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  const copy = getCopy(locale);
  const [dashboard, jobCounts, apiBudget, stateCounts] = await Promise.all([
    getDashboardView(),
    getJobCountsView(),
    getApiBudgetMeterView(),
    getCandidateStateCountsView()
  ]);
  const ready = dashboard.kind === 'ready';
  const data = dashboard.data;
  const summary = summarizeStateCounts(stateCounts);

  const briefingLine = !ready
    ? copy.briefingUnavailable
    : summary.review > 0
      ? formatCount(copy.briefingNeedsReview, summary.review)
      : summary.inProgress > 0
        ? formatCount(copy.briefingInProgress, summary.inProgress)
        : summary.total > 0
          ? formatCount(copy.briefingRecorded, summary.total)
          : copy.noCandidates;

  const generatedAt = new Intl.DateTimeFormat(
    locale === 'ko' ? 'ko-KR' : 'en-US',
    { dateStyle: 'medium', timeStyle: 'short' }
  ).format(new Date());

  return (
    <div className="content-stack">
      <header className="briefing">
        <p className="briefing__meta">{copy.briefingBasis} {generatedAt}</p>
        <h1>{briefingLine}</h1>
        <p className="briefing__support">{copy.homeDescription}</p>
        {ready ? null : (
          <p className="notice notice--error" role="status">{copy.dataUnavailable}</p>
        )}
        <div className="briefing__actions">
          <ResearchNowButton locale={locale} />
          <ButtonLink href={localizedHref(locale, '/imports/new')} variant="secondary">
            {copy.newImport}
          </ButtonLink>
        </div>
      </header>

      <div className="dashboard-grid">
        <DecisionQueue locale={locale} candidates={data.candidates} ready={ready} />
        <div className="dashboard-grid__aside">
          <ResearchPulse
            locale={locale}
            counts={jobCounts}
            budget={apiBudget}
            summary={summary}
            importsTotal={data.totals.imports}
            ready={ready}
          />
          <section
            className="panel panel--inset recent-imports-evidence"
            aria-labelledby="recent-imports-title"
          >
            <div className="section-heading">
              <h2 id="recent-imports-title">{copy.recentImports}</h2>
              <a href={localizedHref(locale, '/imports')}>{copy.viewAllImports}</a>
            </div>
            {data.imports.length === 0 ? (
              <p className="evidence-empty">{copy.noImports}</p>
            ) : (
              <ul className="evidence-imports">
                {data.imports.slice(0, 3).map((importRun) => (
                  <li key={importRun.id}>
                    <div className="evidence-imports__main">
                      <span className="evidence-imports__date">
                        {localeDate(importRun.created_at, locale)}
                      </span>
                      <LocalizedStatusBadge status={importRun.status} locale={locale} />
                    </div>
                    <span className="evidence-imports__counts">
                      {importRun.file_count} {copy.fileCount} · {importRun.total_row_count}{' '}
                      {copy.rowCount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
