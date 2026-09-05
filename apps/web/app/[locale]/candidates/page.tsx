import { getCopy, type Locale } from '@ara/shared';
import { ButtonLink, CandidateStateBadge, EmptyState, toneForState } from '../../../components/ui';
import { localizedHref, parseLocale } from '../../../lib/locale';
import { getCandidatesView } from '../../../lib/server/dashboard-data';
import {
  buildResearchObjects,
  scoreIsPreliminaryOnly,
  type ResearchObject,
  type CandidateRecordRef
} from '../../../lib/research-objects';
import { formatCount } from '../../../lib/dashboard-metrics';
import { requireAdminPage } from '../../../lib/server/admin-page-auth';
import { EvidenceStatusNote } from '../../../components/evidence-status-note';
import { evidencePresentation } from '../../../lib/evidence-copy';

export const dynamic = 'force-dynamic';

function RecordRow({
  locale,
  record
}: {
  locale: Locale;
  record: CandidateRecordRef;
}) {
  const copy = getCopy(locale);
  const href = localizedHref(locale, `/candidates/${record.id}`);
  return (
    <li className="research-object__record">
      <a href={href} aria-label={`${copy.openCandidate}: ${record.keyword}`}>
        {copy.openCandidate}
      </a>
      <span className="research-object__record-state">
        {record.state ? (
          <CandidateStateBadge state={record.state} locale={locale} />
        ) : (
          <span className="research-object__record-id">{record.id}</span>
        )}
      </span>
      {record.preliminaryScore !== null ? (
        <span className="research-object__record-score">{record.preliminaryScore}</span>
      ) : null}
    </li>
  );
}

function ResearchObjectRow({
  locale,
  object
}: {
  locale: Locale;
  object: ResearchObject;
}) {
  const copy = getCopy(locale);
  // Focal link, lead state, and lead reason all come from the same
  // deterministic lead record (see buildResearchObjects).
  const lead = object.leadRecord;
  const href = localizedHref(locale, `/candidates/${lead.id}`);
  const preliminaryOnly = scoreIsPreliminaryOnly(object);
  return (
    <article
      className={`research-object research-object--${toneForState(object.leadState ?? '')}`}
      data-testid="research-object"
    >
      <div className="research-object__main">
        <div className="research-object__keyword">
          <a href={href}>{object.keyword}</a>
          {object.records.length > 1 ? (
            <span className="research-object__count">
              {formatCount(copy.recordsInGroup, object.records.length)}
            </span>
          ) : null}
        </div>
        <EvidenceStatusNote view={lead.evidence} locale={locale} />
        <span className="research-object__score-note">{evidencePresentation(lead.evidence, locale).missing}</span>
        {preliminaryOnly && object.scores.length > 0 ? (
          <span className="research-object__score-note">{copy.scoreNotVerdict}</span>
        ) : null}
      </div>
      <div className="research-object__state">
        {/* Mixed-state objects show the real per-state counts instead of a
            single lead badge, so collapsed view never hides readiness split. */}
        {object.mixedStates ? (
          <span className="research-object__breakdown">
            {object.stateBreakdown.map((entry, index) => (
              <span className="research-object__breakdown-item" key={entry.state}>
                {index > 0 ? <span className="research-object__breakdown-dot" aria-hidden="true"> · </span> : null}
                <CandidateStateBadge state={entry.state} locale={locale} />
                <span className="research-object__breakdown-count">{entry.count}</span>
              </span>
            ))}
          </span>
        ) : object.leadState ? (
          <CandidateStateBadge state={object.leadState} locale={locale} />
        ) : null}
      </div>
      <div className="research-object__action">
        <a href={href} aria-label={`${copy.openCandidate}: ${object.keyword}`}>
          {copy.openCandidate}
        </a>
        {object.records.length > 1 ? (
          <details className="research-object__details">
            <summary>{formatCount(copy.groupShowRecords, object.records.length)}</summary>
            <ul className="research-object__record-list">
              {object.records.map((record) => (
                <RecordRow key={record.id} locale={locale} record={record} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </article>
  );
}

export default async function CandidatesPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  await requireAdminPage(locale);
  const copy = getCopy(locale);
  const candidates = await getCandidatesView();
  const objects = buildResearchObjects(candidates);
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
            <span className="section-count">{objects.length}</span>
          </div>
          <ButtonLink href={localizedHref(locale, '/imports/new')} variant="secondary">
            {copy.newImport}
          </ButtonLink>
        </div>
        <p className="candidates-note">{copy.candidatesJudgeNote}</p>
        {candidates.length === 0 ? (
          <div className="empty-block">
            <EmptyState>{copy.noCandidates}</EmptyState>
            <p className="empty-state-hint">{copy.queueEmptyHint}</p>
          </div>
        ) : (
          <div className="research-object-list">
            {objects.map((object) => (
              <ResearchObjectRow key={object.key} locale={locale} object={object} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
