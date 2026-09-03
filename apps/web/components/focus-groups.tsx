import { getCopy, type Locale } from '@ara/shared';
import { formatCount } from '../lib/dashboard-metrics';
import { localizedHref } from '../lib/locale';
import type { ResearchObject } from '../lib/research-objects';
import { ButtonLink, CandidateStateBadge } from './ui';

/**
 * The dashboard queue: the same research objects the Candidates page shows,
 * in compact form. The focal decision (DecisionCall) owns the judgment
 * narrative; this list only names objects, their state, and how to open
 * them. Lead state/reason/link all read from the object's single lead
 * record; mixed-state objects show the real state counts.
 */
function ResearchObjectItem({
  locale,
  object
}: {
  locale: Locale;
  object: ResearchObject;
}) {
  const copy = getCopy(locale);
  const detailHref = localizedHref(locale, `/candidates/${object.leadRecord.id}`);
  return (
    <li className="group-row">
      <div className="group-row__primary">
        <a className="group-row__keyword" href={detailHref}>
          {object.keyword}
        </a>
        {object.leadReason ? (
          <p className="group-row__reason">
            <span className="reason-code">
              {object.leadReason[0]!.code}: {object.leadReason[0]!.detail}
            </span>
          </p>
        ) : null}
      </div>
      <span className="group-row__state">
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
      </span>
      {object.records.length > 1 ? (
        <details className="group-row__records">
          <summary>
            {formatCount(copy.recordsInGroup, object.records.length)}
          </summary>
          <ul className="group-row__record-list">
            {object.records.map((record) => (
              <li key={record.id}>
                <a
                  href={localizedHref(locale, `/candidates/${record.id}`)}
                  aria-label={`${copy.openCandidate}: ${record.keyword}`}
                >
                  {copy.openCandidate}
                </a>
                <span>{record.id}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <a
        className="group-row__action"
        href={detailHref}
        aria-label={`${copy.openCandidate}: ${object.keyword}`}
      >
        {copy.openCandidate}
      </a>
    </li>
  );
}

export function FocusGroups({
  locale,
  objects,
  ready
}: {
  locale: Locale;
  objects: readonly ResearchObject[];
  ready: boolean;
}) {
  const copy = getCopy(locale);
  return (
    <section className="panel focus-groups" aria-labelledby="focus-groups-title">
      <div className="section-heading">
        <div className="section-heading__title">
          <h2 id="focus-groups-title">{copy.focusTitle}</h2>
          {ready ? <span className="section-count">{objects.length}</span> : null}
        </div>
        <a href={localizedHref(locale, '/candidates')}>{copy.navCandidates}</a>
      </div>
      <p className="focus-order-note">{copy.focusOrderNote}</p>
      {!ready ? (
        <p className="queue-status">{copy.statusUnavailable}</p>
      ) : objects.length === 0 ? (
        <div className="queue-empty">
          <p className="queue-empty__title">{copy.noCandidates}</p>
          <p className="queue-empty__hint">{copy.queueEmptyHint}</p>
          <ButtonLink href={localizedHref(locale, '/imports/new')} variant="secondary">
            {copy.newImport}
          </ButtonLink>
        </div>
      ) : (
        <ul className="focus-group-list">
          {objects.map((object) => (
            <ResearchObjectItem key={object.key} locale={locale} object={object} />
          ))}
        </ul>
      )}
    </section>
  );
}
