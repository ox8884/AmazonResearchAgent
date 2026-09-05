import { parseLocale, localizedHref } from '../../../../lib/locale';
import { requireAdminPage } from '../../../../lib/server/admin-page-auth';
import { getResearchRunDetail } from '../../../../lib/server/research-run-detail';
import { CandidateStateBadge, localeDate, RunStatusBadge } from '../../../../components/ui';
import { JobLedger } from '../../../../components/job-ledger';

export const dynamic = 'force-dynamic';

export default async function RunDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const route = await params;
  const locale = parseLocale(route.locale);
  await requireAdminPage(locale);
  const data = await getResearchRunDetail(route.id);
  const ko = locale === 'ko';
  if (!data) return <div className="content-stack"><h1>{ko ? '실행 정보를 불러올 수 없습니다' : 'Run details unavailable'}</h1><a href={localizedHref(locale, '/runs')}>{ko ? '실행 목록' : 'All runs'}</a></div>;
  const { run, jobs, candidates } = data;
  const counts = jobs.reduce<Record<string, number>>((result, job) => ({ ...result, [job.status]: (result[job.status] ?? 0) + 1 }), {});
  return <div className="content-stack">
    <a className="back-link" href={localizedHref(locale, '/runs')}>{ko ? '실행 목록' : 'All runs'}</a>
    <header className="page-heading"><h1>{run.logical_run_date} {ko ? '리서치 실행' : 'Research run'}</h1><RunStatusBadge status={run.status} locale={locale} />
      <p>{ko ? '실행 완료는 후보 조사 작업의 배정 완료를 뜻합니다. 각 작업의 처리 결과는 아래에서 확인하세요.' : 'A completed run means candidate jobs were scheduled. Their processing outcomes appear below.'}</p>
    </header>
    <section className="panel"><h2>{ko ? '진행 기록' : 'Progress'}</h2><dl className="settings-list">
      {[[ko ? '시작' : 'Started', run.started_at], [ko ? '배정 완료' : 'Scheduling completed', run.completed_at], [ko ? '마지막 갱신' : 'Last updated', run.updated_at]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ? localeDate(value, locale) : '—'}</dd></div>)}
    </dl><p>{ko ? '직접 연결된 작업' : 'Directly linked jobs'}: {jobs.length}{data.jobsTruncated ? '+' : ''} · {ko ? '완료' : 'Completed'} {counts.completed ?? 0} · {ko ? '실패' : 'Failed'} {counts.failed ?? 0} · {ko ? '대기' : 'Queued'} {counts.queued ?? 0} · {ko ? '실행 중' : 'Running'} {counts.running ?? 0}</p></section>
    <section className="panel"><h2>{ko ? '선택된 후보의 현재 상태' : 'Current state of selected candidates'} ({candidates.length})</h2>
      {!data.selectedIdsValid ? <p>{ko ? '선택 후보 기록을 해석하지 못했습니다.' : 'Selected candidate records could not be parsed.'}</p> : null}
      <ul>{candidates.map((candidate) => <li key={candidate.id}><a href={localizedHref(locale, `/candidates/${candidate.id}`)}>{candidate.keyword}</a>{' '}<CandidateStateBadge state={candidate.state} locale={locale} /></li>)}</ul>
      <p>{ko ? '이 상태는 현재 값입니다. 실행 당시 결과와 다를 수 있습니다.' : 'These are current states and may differ from the result at run time.'}</p>
    </section>
    <section className="panel"><h2>{ko ? '연결 작업' : 'Linked jobs'}</h2><p>{ko ? '실행 ID가 기록된 작업만 포함합니다. 연결 정보가 없는 별도 정리·연결 테스트는 포함하지 않습니다.' : 'Only jobs with this run ID are included. Unlinked normalization and connection tests are excluded.'}</p><JobLedger jobs={jobs} locale={locale} /></section>
    <details><summary>{ko ? '실행 식별자' : 'Run identifier'}</summary><code>{run.id}</code></details>
  </div>;
}
