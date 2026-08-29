import { getCopy } from '@ara/shared';
import { EmptyState } from '../../../components/ui';
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
      </header>
      <section className="panel">
        {candidates.length === 0 ? (
          <EmptyState>{copy.noCandidates}</EmptyState>
        ) : (
          <div className="import-list">
            {candidates.map((candidate) => (
              <article className="import-row" key={candidate.id}>
                <div>
                  <p className="import-row__title">
                    <a href={localizedHref(locale, `/candidates/${candidate.id}`)}>
                      {candidate.keyword}
                    </a>
                  </p>
                  <p className="import-row__meta">{candidate.state}</p>
                </div>
                <span>{candidate.preliminary_score ?? '—'}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
