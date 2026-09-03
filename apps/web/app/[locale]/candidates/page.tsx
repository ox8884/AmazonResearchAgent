import { getCopy } from '@ara/shared';
import { ButtonLink, CandidateStateBadge, EmptyState, toneForState } from '../../../components/ui';
import { localizedHref, parseLocale } from '../../../lib/locale';
import { getCandidatesView } from '../../../lib/server/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function CandidatesPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  const copy = getCopy(locale);
  const candidates = await getCandidatesView();
  return (
    <div className="content-stack">
      <header className="page-heading">
        <h1>{copy.candidatesTitle}</h1>
        <p>{copy.totalCandidates}: {candidates.length}</p>
      </header>
      <section className="panel" aria-labelledby="candidates-table-title">
        <div className="section-heading">
          <div className="section-heading__title">
            <h2 id="candidates-table-title">{copy.candidateTitle}</h2>
            <span className="section-count">{candidates.length}</span>
          </div>
          <ButtonLink href={localizedHref(locale, '/imports/new')} variant="secondary">
            {copy.newImport}
          </ButtonLink>
        </div>
        {candidates.length === 0 ? (
          <div className="empty-block">
            <EmptyState>{copy.noCandidates}</EmptyState>
            <p className="empty-state-hint">{copy.queueEmptyHint}</p>
          </div>
        ) : (
          <div className="ledger">
            <div className="ledger__head" aria-hidden="true">
              <span>{copy.keywordLabel}</span>
              <span>{copy.statusLabel}</span>
              <span>{copy.scoreLabel}</span>
            </div>
            {candidates.map((candidate) => (
              <article
                className={`ledger__row ledger__row--${toneForState(candidate.state)}`}
                key={candidate.id}
              >
                <div className="ledger__primary">
                  <a href={localizedHref(locale, `/candidates/${candidate.id}`)}>
                    {candidate.keyword}
                  </a>
                </div>
                <div className="ledger__state">
                  <CandidateStateBadge state={candidate.state} locale={locale} />
                </div>
                <div className="ledger__score">
                  <span className="ledger__mobile-label">{copy.scoreLabel}</span>
                  <strong>{candidate.preliminary_score ?? '-'}</strong>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
