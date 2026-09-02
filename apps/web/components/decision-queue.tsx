import { getCopy, RuleReasonSchema, type Locale } from '@ara/shared';
import type { CandidateSummary } from '../lib/server/dashboard-data';
import { localizedHref } from '../lib/locale';
import { ButtonLink, CandidateStateBadge, toneForState } from './ui';

export function DecisionQueue({
  locale,
  candidates,
  ready
}: {
  locale: Locale;
  candidates: readonly CandidateSummary[];
  ready: boolean;
}) {
  const copy = getCopy(locale);
  return (
    <section className="panel decision-queue" aria-labelledby="decision-queue-title">
      <div className="section-heading">
        <div className="section-heading__title">
          <h2 id="decision-queue-title">{copy.queueTitle}</h2>
          {ready ? <span className="section-count">{candidates.length}</span> : null}
        </div>
        <a href={localizedHref(locale, '/candidates')}>{copy.navCandidates}</a>
      </div>
      <p className="queue-order-note">{copy.queueOrderNote}</p>
      {!ready ? (
        <p className="queue-status">{copy.statusUnavailable}</p>
      ) : candidates.length === 0 ? (
        <div className="queue-empty">
          <p className="queue-empty__title">{copy.noCandidates}</p>
          <p className="queue-empty__hint">{copy.queueEmptyHint}</p>
          <ButtonLink href={localizedHref(locale, '/imports/new')} variant="secondary">
            {copy.newImport}
          </ButtonLink>
        </div>
      ) : (
        <div className="queue-list">
          {candidates.map((candidate) => {
            const reasons = RuleReasonSchema.array().safeParse(candidate.rule_reasons);
            const hasReasons = reasons.success && reasons.data.length > 0;
            const detailHref = localizedHref(locale, `/candidates/${candidate.id}`);
            return (
              <article
                className={`queue-row queue-row--${toneForState(candidate.state)}`}
                key={candidate.id}
              >
                <div className="queue-row__primary">
                  <a className="queue-row__keyword" href={detailHref}>
                    {candidate.keyword}
                  </a>
                  <CandidateStateBadge state={candidate.state} locale={locale} />
                  {hasReasons ? (
                    <p className="queue-row__reason">
                      {reasons.data.map((reason) => (
                        <span className="reason-code" key={`${reason.code}:${reason.detail}`}>
                          {reason.code}: {reason.detail}
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="queue-row__reason queue-row__reason--empty">
                      {copy.noReasonRecorded}
                    </p>
                  )}
                </div>
                <div className="queue-row__score">
                  <span className="queue-row__score-label">{copy.scoreLabel}</span>
                  <strong>{candidate.preliminary_score ?? '-'}</strong>
                </div>
                <a className="queue-row__action" href={detailHref}>
                  {copy.openCandidate}
                </a>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
