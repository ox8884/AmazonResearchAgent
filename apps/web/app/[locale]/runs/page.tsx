import { getCopy } from '@ara/shared';
import { EmptyState, localeDate } from '../../../components/ui';
import { parseLocale } from '../../../lib/locale';
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
      <header className="page-heading">
        <h1>{copy.runsTitle}</h1>
      </header>
      <section className="panel">
        {runs.length === 0 ? (
          <EmptyState>{copy.noRuns}</EmptyState>
        ) : (
          <div className="import-list">
            {runs.map((run) => (
              <article className="import-row" key={run.id}>
                <div>
                  <p className="import-row__title">{run.source}</p>
                  <p className="import-row__meta">
                    {run.logicalRunDate} · {localeDate(run.createdAt, locale)}
                  </p>
                </div>
                <span>{run.status}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
