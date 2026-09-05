import { getCopy } from '@ara/shared';
import { EmptyState, localeDate, RunStatusBadge } from '../../../components/ui';
import { localizedHref, parseLocale } from '../../../lib/locale';
import { getResearchRunsView } from '../../../lib/server/dashboard-data';
import { requireAdminPage } from '../../../lib/server/admin-page-auth';
import { getActiveQueueJobs } from '../../../lib/server/research-run-detail';
import { JobLedger } from '../../../components/job-ledger';

export const dynamic = 'force-dynamic';

export default async function RunsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  await requireAdminPage(locale);
  const copy = getCopy(locale);
  const [runs, queue] = await Promise.all([getResearchRunsView(), getActiveQueueJobs()]);
  return (
    <div className="content-stack">
      <header className="page-heading page-heading--split">
        <div>
          <h1>{copy.runsTitle}</h1>
          <p>{copy.runsProvenanceNote}</p>
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
                  <a href={localizedHref(locale, `/runs/${run.id}`)}><strong>{run.logicalRunDate}</strong> · {locale === 'ko' ? '결과 보기' : 'View results'}</a>
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
      <section className="panel"><h2>{locale === 'ko' ? '전체 작업 대기열 · 실행 중/실패' : 'All queue jobs · running/failed'}</h2>
        <p>{locale === 'ko' ? '리서치 외에 AI 연결 테스트 등 운영 작업도 포함됩니다.' : 'Includes operational jobs such as AI connection tests.'}</p>
        {queue ? <><JobLedger jobs={queue.jobs} locale={locale} />{queue.truncated ? <p>{locale === 'ko' ? '최근 50개만 표시합니다.' : 'Showing the latest 50 jobs.'}</p> : null}</> : <p>{copy.dataUnavailable}</p>}
      </section>
    </div>
  );
}
