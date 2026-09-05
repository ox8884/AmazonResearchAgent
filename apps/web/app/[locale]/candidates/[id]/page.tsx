import { getCopy } from '@ara/shared';
import { CandidateScoreCard } from '../../../../components/candidate-score-card';
import { CandidateEvidenceDetail } from '../../../../components/candidate-evidence-detail';
import { CandidateBusinessForm } from '../../../../components/candidate-business-form';
import { CandidateStateBadge } from '../../../../components/ui';
import { localizedHref, parseLocale } from '../../../../lib/locale';
import { getCandidateDetailView } from '../../../../lib/server/dashboard-data';
import { requireAdminPage } from '../../../../lib/server/admin-page-auth';

export const dynamic = 'force-dynamic';

export default async function CandidateDetailPage({
  params
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: localeParam, id } = await params;
  const locale = parseLocale(localeParam);
  await requireAdminPage(locale);
  const copy = getCopy(locale);
  const candidate = await getCandidateDetailView(id);
  return (
    <div className="content-stack">
      <a className="back-link" href={localizedHref(locale, '/candidates')}>{copy.navCandidates}</a>
      <header className="page-heading candidate-detail-heading">
        <div>
          <p className="candidate-detail__question">{copy.detailVerdictQuestion}</p>
          <h1>{candidate.keyword ?? copy.candidateTitle}</h1>
        </div>
        <div className="candidate-detail-heading__meta">
          {candidate.state ? <CandidateStateBadge state={candidate.state} locale={locale} /> : null}
        </div>
      </header>
      <CandidateEvidenceDetail view={candidate.evidence} locale={locale} />
      <CandidateBusinessForm candidateId={id} />
      <section className="evidence-panel" aria-labelledby="score-provenance-title">
        <div className="section-heading"><h2 id="score-provenance-title">{locale === 'ko' ? '점수 기록 구분' : 'Score provenance'}</h2></div>
        <p>{copy.scoreLabel}: {candidate.preliminaryScore ?? (locale === 'ko' ? '미계산' : 'Not calculated')}</p>
        <p>{locale === 'ko' ? '가져오기 단계의 선별 점수입니다. 분석 총점이나 수익률과 같은 값이 아닙니다.' : 'This is the import screening score, not the analysis total or a profit margin.'}</p>
        <CandidateScoreCard locale={locale} competition={candidate.competition}
          demand={candidate.demand} margin={candidate.margin} differentiation={candidate.differentiation} />
      </section>
      <details className="candidate-detail__technical">
        <summary>{copy.technicalDetails}</summary>
        <dl><div><dt>{copy.importIdLabel}</dt><dd><code>{id}</code></dd></div></dl>
      </details>
    </div>
  );
}
