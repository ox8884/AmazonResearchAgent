import { getCopy } from '@ara/shared';
import { EmptyState, localeDate, RunStatusBadge } from '../../../components/ui';
import { localizedHref, parseLocale } from '../../../lib/locale';
import { getResearchRunsView } from '../../../lib/server/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function RunsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  const copy = getCopy(locale);
  const runs = await getResearchRunsView();
  return (
    <div className="content-stack">
      <header className="page-heading page-heading--split">
        <div>
          <h1>{copy.runsTitle}</h1>
          <p>{copy.statusLabel}: {runs.length}</p>
        </div>
        <a className="button button--secondary" href={localizedHref(locale, '/dashboard')}>
          {copy.navDashboard}
        </a>
      </header>
      <section className="panel" aria-labelledby="runs-ledger-title">
        <div className="section-heading">
          <h2 id="runs-ledger-title">{copy.runsTitle}</h2>
          <span className="section-count">{runs.length}</span>
        </div>
        {runs.length === 0 ? (
          <EmptyState>{copy.noRuns}</EmptyState>
        ) : (
          <div className="ledger runs-ledger">
            <div className="ledger__head" aria-hidden="true">
              <span>{copy.createdAt}</span>
              <span>{copy.statusLabel}</span>
              <span>{copy.sourceManual}</span>
            </div>
            {runs.map((run) => (
              <article className="ledger__row" key={run.id}>
                <div className="ledger__primary">
                  <strong>{run.logicalRunDate}</strong>
                  <code>{run.id}</code>
                </div>
                <div className="ledger__state">
                  <RunStatusBadge status={run.status} locale={locale} />
                </div>
                <div className="ledger__meta">
                  {run.source === 'scheduled' ? copy.sourceScheduled : copy.sourceManual}
                  <span>{localeDate(run.createdAt, locale)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
