import { getCopy, type Locale, type RuleReason } from '@ara/shared';
import { localizedHref } from '../lib/locale';
import { ResearchNowButton } from './research-now-button';
import { CandidateStateBadge, toneForState } from './ui';

/**
 * The dashboard's single focal decision. Everything rendered here is derived
 * from the lead research object's single lead record (recorded state, score,
 * and rule reasons only): why this deserves attention → what is not yet
 * verified → the next action. The no-evidence state is stated once, in the
 * gap row; the reason row stays silent when there is nothing recorded.
 */
export function DecisionCall({
  locale,
  object
}: {
  locale: Locale;
  object: {
    readonly keyword: string;
    readonly leadState: string | null;
    readonly leadReason: readonly RuleReason[] | null;
    readonly records: readonly {
      readonly id: string;
      readonly keyword: string;
      readonly preliminaryScore: number | null;
    }[];
    /** The one record the state/reason are derived from — action must use it. */
    readonly leadRecord: { readonly id: string };
  };
}) {
  const copy = getCopy(locale);
  const lead = object.leadRecord;
  const hasEvidence = object.leadReason !== null;
  return (
    <section
      className={`panel decision-call decision-call--${toneForState(object.leadState ?? '')}`}
      aria-labelledby="decision-call-title"
    >
      <div className="decision-call__head">
        <p className="decision-call__eyebrow">{copy.decisionCallTitle}</p>
        {object.leadState ? <CandidateStateBadge state={object.leadState} locale={locale} /> : null}
      </div>
      <h2 id="decision-call-title">{object.keyword}</h2>
      {object.records.length > 1 ? (
        <p className="decision-call__records">
          {copy.recordsInGroup.replace('{count}', String(object.records.length))}
        </p>
      ) : null}
      <dl className="decision-call__flow">
        <div className="decision-call__step">
          <dt>{copy.decisionWhy}</dt>
          <dd>
            {hasEvidence ? (
              <span className="decision-call__reasons">
                {object.leadReason!.slice(0, 2).map((reason) => (
                  <span className="reason-code" key={`${reason.code}:${reason.detail}`}>
                    {reason.code}: {reason.detail}
                  </span>
                ))}
              </span>
            ) : (
              <span className="decision-call__unrecorded">{copy.preVerificationLabel}</span>
            )}
          </dd>
        </div>
        <div className="decision-call__step">
          <dt>{copy.decisionGap}</dt>
          <dd>
            {hasEvidence ? copy.decisionGapNone : copy.preVerificationDetail}
          </dd>
        </div>
        <div className="decision-call__step decision-call__step--act">
          <dt>{copy.decisionAct}</dt>
          <dd>
            {lead ? (
              <a
                className="decision-call__action"
                href={localizedHref(locale, `/candidates/${lead.id}`)}
                aria-label={`${copy.openCandidate}: ${object.keyword}`}
              >
                {copy.openCandidate}
              </a>
            ) : null}
          </dd>
        </div>
      </dl>
      <div className="briefing__actions">
        <ResearchNowButton locale={locale} />
      </div>
    </section>
  );
}
