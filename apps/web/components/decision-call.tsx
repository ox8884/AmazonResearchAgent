import { getCopy, type Locale } from '@ara/shared';
import type { ResearchObject } from '../lib/research-objects';
import { evidencePresentation } from '../lib/evidence-copy';
import { EvidenceStatusNote } from './evidence-status-note';
import { localizedHref } from '../lib/locale';
import { CandidateStateBadge, toneForState } from './ui';

/**
 * The dashboard's single focal decision. Everything rendered here is derived
 * from the lead research object's single lead record. Collection status and
 * gaps come from evidence, never from rule-filter reasons.
 */
export function DecisionCall({
  locale,
  object
}: {
  locale: Locale;
  object: ResearchObject;
}) {
  const copy = getCopy(locale);
  const lead = object.leadRecord;
  const evidence = evidencePresentation(lead.evidence, locale);
  const summary = lead.evidence.kind === 'ready' ? lead.evidence.summary : null;
  const ko = locale === 'ko';
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
      <dl className="desk-readings">
        <div><dt>{ko ? '월 검색량' : 'Monthly searches'}</dt><dd>{summary?.monthlySearchVolume == null ? '—' : new Intl.NumberFormat(locale).format(summary.monthlySearchVolume)}</dd><small>{summary?.searchVolumeIsUpperBound ? (ko ? '제공처 상한값' : 'Source upper bound') : (ko ? '저장된 검색량 자료' : 'Recorded search data')}</small></div>
        <div><dt>{ko ? '분석 점수' : 'Analysis score'}</dt><dd>{summary?.analysisScore ?? '—'}<small> / 100</small></dd><small>{ko ? '발주 승인·수익률 아님' : 'Not purchase approval or margin'}</small></div>
      </dl>
      {object.records.length > 1 ? (
        <p className="decision-call__records">
          {copy.recordsInGroup.replace('{count}', String(object.records.length))}
        </p>
      ) : null}
      <dl className="decision-call__flow">
        <div className="decision-call__step">
          <dt>{copy.decisionWhy}</dt>
          <dd>
            <EvidenceStatusNote view={lead.evidence} locale={locale} />
          </dd>
        </div>
        <div className="decision-call__step">
          <dt>{copy.decisionGap}</dt>
          <dd>
            {evidence.missing}
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
    </section>
  );
}
