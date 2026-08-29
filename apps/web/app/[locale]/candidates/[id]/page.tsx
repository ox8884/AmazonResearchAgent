import { getCopy } from '@ara/shared';
import { CandidateScoreCard } from '../../../../components/candidate-score-card';
import { parseLocale } from '../../../../lib/locale';
import { getCandidateDetailView } from '../../../../lib/server/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function CandidateDetailPage({
  params
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: localeParam, id } = await params;
  const locale = parseLocale(localeParam);
  const copy = getCopy(locale);
  const candidate = await getCandidateDetailView(id);
  return (
    <div className="content-stack">
      <header className="page-heading">
        <h1>{candidate.keyword ?? copy.candidateTitle}</h1>
        <p>{candidate.state ?? id}</p>
      </header>
      <CandidateScoreCard
        locale={locale}
        competition={candidate.competition}
        demand={candidate.demand}
        margin={candidate.margin}
        differentiation={candidate.differentiation}
      />
      {candidate.evidence.length > 0 ? (
        <section className="panel">
          <h2>{copy.decisionReasonLabel}</h2>
          <ul>
            {candidate.evidence.map((item) => (
              <li key={item.kind}>{item.kind}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
