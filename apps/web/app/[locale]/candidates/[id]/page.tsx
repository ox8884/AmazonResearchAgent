import { getCopy } from '@ara/shared';
import { CandidateScoreCard } from '../../../../components/candidate-score-card';
import { CandidateStateBadge } from '../../../../components/ui';
import { localizedHref, parseLocale } from '../../../../lib/locale';
import { getCandidateDetailView } from '../../../../lib/server/dashboard-data';

export const dynamic = 'force-dynamic';

function evidenceValue(value: unknown): string {
  if (value === null) return '-';
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} items`;
  return 'structured data';
}

export default async function CandidateDetailPage({
  params
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: localeParam, id } = await params;
  const locale = parseLocale(localeParam);
  const copy = getCopy(locale);
  const candidate = await getCandidateDetailView(id);
  const hasScore =
    candidate.competition !== null ||
    candidate.demand !== null ||
    candidate.margin !== null ||
    candidate.differentiation !== null;
  return (
    <div className="content-stack">
      <a className="back-link" href={localizedHref(locale, '/candidates')}>{copy.navCandidates}</a>
      <header className="page-heading candidate-detail-heading">
        <div>
          <p className="candidate-detail__question">{copy.detailVerdictQuestion}</p>
          <h1>{candidate.keyword ?? copy.candidateTitle}</h1>
        </div>
        <div className="candidate-detail-heading__meta">
          <CandidateStateBadge state={candidate.state ?? 'Discovered'} locale={locale} />
        </div>
      </header>
      <section className="evidence-panel" aria-labelledby="evidence-title">
        <div className="section-heading">
          <h2 id="evidence-title">{copy.detailSignalsTitle}</h2>
          {hasScore ? (
            <span className="section-count">{candidate.evidence.length}</span>
          ) : (
            <span className="section-count section-count--uncomputed">{copy.signalsNotComputed}</span>
          )}
        </div>
        <CandidateScoreCard
          locale={locale}
          competition={candidate.competition}
          demand={candidate.demand}
          margin={candidate.margin}
          differentiation={candidate.differentiation}
        />
        <div className="section-heading detail-gap-heading">
          <h2>{copy.detailGapTitle}</h2>
        </div>
        {candidate.evidence.length === 0 ? (
          <p className="empty-state">{copy.noEvidence}</p>
        ) : (
          <div className="evidence-list">
            {candidate.evidence.map((item, index) => {
              const payload: readonly (readonly [string, unknown])[] =
                item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
                  ? Object.entries(item.payload).slice(0, 6)
                  : [['value', item.payload]];
              return (
                <article className="evidence-item" key={`${item.kind}-${index}`}>
                  <h3><code>{item.kind}</code></h3>
                  <dl>
                    {payload.map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{evidenceValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
        )}
        <details className="candidate-detail__technical">
          <summary>{copy.technicalDetails}</summary>
          <dl>
            <div>
              <dt>{copy.importIdLabel}</dt>
              <dd><code>{id}</code></dd>
            </div>
          </dl>
        </details>
      </section>
    </div>
  );
}
