import { getCopy, RuleReasonSchema } from '@ara/shared';
import { ApiUsageMeter } from '../../components/api-usage-meter';
import { ResearchActivity } from '../../components/research-activity';
import { ResearchNowButton } from '../../components/research-now-button';
import {
  ButtonLink,
  CandidateStateBadge,
  EmptyState,
  localeDate,
  LocalizedStatusBadge
} from '../../components/ui';
import { localizedHref, parseLocale } from '../../lib/locale';
import {
  getApiBudgetMeterView,
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
  const [dashboard, jobCounts, apiBudget] = await Promise.all([
    getDashboardView(),
    getJobCountsView(),
    getApiBudgetMeterView()
  ]);
  const data = dashboard.data;
  const total = Math.max(data.totals.candidates, 1);
  return (
    <div className="content-stack">
      <header className="page-heading page-heading--split">
        <div>
          <h1>{copy.homeTitle}</h1>
          <p>{copy.homeDescription}</p>
        </div>
        <ButtonLink href={localizedHref(locale, '/imports/new')} variant="secondary">
          {copy.newImport}
        </ButtonLink>
      </header>

      {dashboard.kind === 'unavailable' ? (
        <p className="notice notice--error" role="status">{copy.dataUnavailable}</p>
      ) : null}

      <section className="panel operations-panel" aria-labelledby="operations-title">
        <div className="section-heading">
          <div>
            <h2 id="operations-title">{copy.researchNow}</h2>
          </div>
          <ResearchNowButton locale={locale} />
        </div>
        <div className="operations-panel__body">
          <ResearchActivity locale={locale} counts={jobCounts} />
          <ApiUsageMeter locale={locale} meter={apiBudget} />
        </div>
      </section>

      <section className="panel decision-funnel" aria-labelledby="decision-funnel-title">
        <div className="section-heading">
          <div>
            <h2 id="decision-funnel-title">{copy.totalCandidates}</h2>
          </div>
        </div>
        <ol className="funnel-list">
          <li>
            <span>{copy.totalImports}</span>
            <strong>{data.totals.imports}</strong>
          </li>
          <li>
            <span>{copy.totalCandidates}</span>
            <strong>{data.totals.candidates}</strong>
            <progress max={total} value={Math.min(data.totals.candidates, total)} />
          </li>
          <li>
            <span>{copy.acceptedLabel}</span>
            <strong>{data.totals.accepted}</strong>
            <progress max={total} value={Math.min(data.totals.accepted, total)} />
          </li>
          <li>
            <span>{copy.rejectedLabel}</span>
            <strong>{data.totals.rejected}</strong>
            <progress max={total} value={Math.min(data.totals.rejected, total)} />
          </li>
        </ol>
      </section>

      <section className="panel" aria-labelledby="recent-candidates-title">
        <div className="section-heading">
          <h2 id="recent-candidates-title">{copy.recentCandidates}</h2>
          <a href={localizedHref(locale, '/candidates')}>{copy.navCandidates}</a>
        </div>
        {data.candidates.length === 0 ? (
          <EmptyState>{copy.noCandidates}</EmptyState>
        ) : (
          <div className="data-list">
            {data.candidates.map((candidate) => {
              const reasons = RuleReasonSchema.array().safeParse(candidate.rule_reasons);
              return (
                <article className="data-row" key={candidate.id}>
                  <div className="data-row__primary">
                    <strong>{candidate.keyword}</strong>
                    <CandidateStateBadge state={candidate.state} locale={locale} />
                  </div>
                  <div className="data-row__score">
                    <span>{copy.scoreLabel}</span>
                    <strong>{candidate.preliminary_score ?? '—'}</strong>
                  </div>
                  <div className="data-row__reason">
                    {reasons.success && reasons.data.length > 0
                      ? reasons.data.map((reason) => (
                          <span className="reason-code" key={`${reason.code}:${reason.detail}`}>
                            {reason.code}: {reason.detail}
                          </span>
                        ))
                      : copy.decisionReasonLabel}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="recent-imports-title">
        <div className="section-heading">
          <h2 id="recent-imports-title">{copy.recentImports}</h2>
          <a href={localizedHref(locale, '/imports')}>{copy.viewAllImports}</a>
        </div>
        {data.imports.length === 0 ? (
          <EmptyState>{copy.noImports}</EmptyState>
        ) : (
          <div className="import-list">
            {data.imports.map((importRun) => (
              <article className="import-row" key={importRun.id}>
                <div>
                  <p className="import-row__title">{localeDate(importRun.created_at, locale)}</p>
                  <p className="import-row__meta">{importRun.id}</p>
                </div>
                <LocalizedStatusBadge status={importRun.status} locale={locale} />
                <div className="import-row__counts">
                  <span>{importRun.file_count} {copy.fileCount}</span>
                  <span>{importRun.total_row_count} {copy.rowCount}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
