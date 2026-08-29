import { getCopy, RuleReasonSchema } from '@ara/shared';
import { ResearchNowButton } from '../../components/research-now-button';
import { ButtonLink, EmptyState, localeDate, LocalizedStatusBadge, MetricCard } from '../../components/ui';
import { localizedHref, parseLocale } from '../../lib/locale';
import { getDashboardView } from '../../lib/server/dashboard-data';
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  const copy = getCopy(locale);
  const dashboard = await getDashboardView();
  const data = dashboard.data;
  return (
    <div className="content-stack">
      <header className="page-heading page-heading--split">
        <div>
          <h1>{copy.homeTitle}</h1>
          <p>{copy.homeDescription}</p>
        </div>
        <div className="cluster">
          <ResearchNowButton locale={locale} />
          <ButtonLink href={localizedHref(locale, '/imports/new')}>{copy.newImport}</ButtonLink>
        </div>
      </header>

      {dashboard.kind === 'unavailable' ? (
        <p className="notice notice--error" role="status">{copy.dataUnavailable}</p>
      ) : null}

      <section aria-label={copy.technicalDetails} className="metric-grid">
        <MetricCard label={copy.totalImports} value={data.totals.imports} />
        <MetricCard label={copy.totalCandidates} value={data.totals.candidates} />
        <MetricCard label={copy.acceptedLabel} value={data.totals.accepted} />
        <MetricCard label={copy.rejectedLabel} value={data.totals.rejected} />
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
                  <p className="import-row__title">{importRun.id}</p>
                  <p className="import-row__meta">{localeDate(importRun.created_at, locale)}</p>
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

      <section className="panel" aria-labelledby="recent-candidates-title">
        <div className="section-heading">
          <h2 id="recent-candidates-title">{copy.recentCandidates}</h2>
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
                    <span className="data-row__meta">{candidate.state}</span>
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
    </div>
  );
}
