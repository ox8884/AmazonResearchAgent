import type { Locale } from '@ara/shared';
import { localeDate, RunStatusBadge } from './ui';

type Job = {
  readonly id: string; readonly type: string; readonly status: string;
  readonly created_at: string; readonly updated_at: string;
  readonly leased_until: string | null; readonly attempts: number; readonly max_attempts: number;
};
const NAMES: Readonly<Record<string, readonly [string, string]>> = {
  TEST_AI_PROVIDER_CONNECTION: ['AI 연결 테스트', 'AI connection test'],
  MARKET_PROBE: ['시장 조사', 'Market research'],
  DAILY_RESEARCH: ['리서치 작업 배정', 'Research scheduling'],
  SEND_DIGEST: ['요약 발송', 'Send digest'],
  NORMALIZE_CANDIDATE: ['후보 정리', 'Candidate normalization']
};

export function JobLedger({ jobs, locale }: { readonly jobs: readonly Job[]; readonly locale: Locale }) {
  const ko = locale === 'ko';
  const now = Date.now();
  return <div className="evidence-list">{jobs.map((job) => {
    const expired = job.status === 'running' && job.leased_until !== null && Date.parse(job.leased_until) < now;
    return <article className="evidence-item" key={job.id}>
      <h3>{NAMES[job.type]?.[ko ? 0 : 1] ?? job.type}</h3>
      <RunStatusBadge status={job.status} locale={locale} />
      {expired ? <p>{ko ? '작업 임대가 만료됐습니다. 실행기의 상태 확인이 필요합니다.' : 'The job lease expired. Check the worker status.'}</p> : null}
      <dl>
        <div><dt>{ko ? '접수' : 'Created'}</dt><dd>{localeDate(job.created_at, locale)}</dd></div>
        <div><dt>{ko ? '마지막 갱신' : 'Last updated'}</dt><dd>{localeDate(job.updated_at, locale)}</dd></div>
        <div><dt>{ko ? '시도 횟수' : 'Attempts'}</dt><dd>{job.attempts} / {job.max_attempts}</dd></div>
      </dl>
      <details><summary>{ko ? '작업 식별자' : 'Job identifier'}</summary><code>{job.id}</code></details>
    </article>;
  })}</div>;
}
