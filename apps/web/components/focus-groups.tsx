import { getCopy, RuleReasonSchema, type Locale } from '@ara/shared';
import { formatCount, type FocusGroup } from '../lib/dashboard-metrics';
import { localizedHref } from '../lib/locale';
import type { CandidateSummary } from '../lib/server/dashboard-data';
import {
  ButtonLink,
  CandidateStateBadge,
  toneForState
} from './ui';

const PREVIEW_ROWS = 3;

function stateElementId(state: string): string {
  return `focus-${state.replace(/\s+/g, '-').toLowerCase()}`;
}

function GroupRow({
  locale,
  candidate
}: {
  locale: Locale;
  candidate: CandidateSummary;
}) {
  const copy = getCopy(locale);
  const detailHref = localizedHref(locale, `/candidates/${candidate.id}`);
  const reasons = RuleReasonSchema.array().safeParse(candidate.rule_reasons);
  return (
    <li className="group-row">
      <div className="group-row__primary">
        <a className="group-row__keyword" href={detailHref}>
          {candidate.keyword}
        </a>
        {reasons.success && reasons.data.length > 0 ? (
          <p className="group-row__reason">
            {reasons.data.map((reason) => (
              <span className="reason-code" key={`${reason.code}:${reason.detail}`}>
                {reason.code}: {reason.detail}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      {candidate.preliminary_score !== null ? (
        <span className="group-row__score">
          <span className="visually-hidden">{copy.scoreLabel}: </span>
          {candidate.preliminary_score}
        </span>
      ) : null}
      <a
        className="group-row__action"
        href={detailHref}
        aria-label={`${copy.openCandidate}: ${candidate.keyword}`}
      >
        {copy.openCandidate}
      </a>
    </li>
  );
}

function FocusGroupSection({
  locale,
  group,
  lead
}: {
  locale: Locale;
  group: FocusGroup;
  lead: boolean;
}) {
  const copy = getCopy(locale);
  const preview = group.rows.slice(0, PREVIEW_ROWS);
  const rest = group.rows.slice(PREVIEW_ROWS);
  const beyondQueue = Math.max(0, group.total - group.rows.length);
  return (
    <section
      className={`focus-group focus-group--${toneForState(group.state)}${lead ? ' focus-group--lead' : ''}`}
      aria-labelledby={stateElementId(group.state)}
    >
      <div className="focus-group__head">
        <h3 id={stateElementId(group.state)}>
          <CandidateStateBadge state={group.state} locale={locale} />
        </h3>
        <span className="focus-group__count">{group.total}</span>
      </div>
      {group.rows.length > 0 && group.allRowsLackRationale ? (
        <p className="focus-group__confidence">{copy.confidenceNotice}</p>
      ) : null}
      <ul className="focus-group__rows">
        {preview.map((candidate) => (
          <GroupRow key={candidate.id} locale={locale} candidate={candidate} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="focus-group__details">
          <summary>{formatCount(copy.groupMore, rest.length)}</summary>
          <ul className="focus-group__rows">
            {rest.map((candidate) => (
              <GroupRow key={candidate.id} locale={locale} candidate={candidate} />
            ))}
          </ul>
        </details>
      ) : null}
      {beyondQueue > 0 ? (
        <a className="focus-group__all" href={localizedHref(locale, '/candidates')}>
          {formatCount(copy.groupAllCandidates, group.total)}
        </a>
      ) : null}
    </section>
  );
}

export function FocusGroups({
  locale,
  groups,
  ready
}: {
  locale: Locale;
  groups: readonly FocusGroup[];
  ready: boolean;
}) {
  const copy = getCopy(locale);
  return (
    <section className="panel focus-groups" aria-labelledby="focus-groups-title">
      <div className="section-heading">
        <div className="section-heading__title">
          <h2 id="focus-groups-title">{copy.focusTitle}</h2>
          {ready ? <span className="section-count">{groups.length}</span> : null}
        </div>
        <a href={localizedHref(locale, '/candidates')}>{copy.navCandidates}</a>
      </div>
      <p className="focus-order-note">{copy.focusOrderNote}</p>
      {!ready ? (
        <p className="queue-status">{copy.statusUnavailable}</p>
      ) : groups.length === 0 ? (
        <div className="queue-empty">
          <p className="queue-empty__title">{copy.noCandidates}</p>
          <p className="queue-empty__hint">{copy.queueEmptyHint}</p>
          <ButtonLink href={localizedHref(locale, '/imports/new')} variant="secondary">
            {copy.newImport}
          </ButtonLink>
        </div>
      ) : (
        <div className="focus-group-list">
          {groups.map((group, index) => (
            <FocusGroupSection
              key={group.state}
              locale={locale}
              group={group}
              lead={index === 0}
            />
          ))}
        </div>
      )}
    </section>
  );
}
