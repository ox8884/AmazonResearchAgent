import { getCopy, type Locale } from '@ara/shared';

const SIGNAL_KEYS = ['competition', 'demand', 'margin', 'differentiation'] as const;
type SignalKey = (typeof SIGNAL_KEYS)[number];

/**
 * The candidate's core-signal panel. With recorded values each signal renders
 * as a labeled numeral rail. With no recorded values at all, the four rails
 * collapse into one honest "not yet computed" state: the signal names remain
 * as accessible headings (E2E contract: `경쟁도`/`Competition` …), but no
 * empty progress bars are drawn.
 */
export function CandidateScoreCard({
  locale,
  competition,
  demand,
  margin,
  differentiation
}: {
  locale: Locale;
  competition: number | null;
  demand: number | null;
  margin: number | null;
  differentiation: number | null;
}) {
  const copy = getCopy(locale);
  const labels: Record<SignalKey, string> = {
    competition: copy.competitionLabel,
    demand: copy.demandLabel,
    margin: copy.marginLabel,
    differentiation: copy.differentiationLabel
  };
  const values: Record<SignalKey, number | null> = {
    competition,
    demand,
    margin,
    differentiation
  };
  const anyValue = SIGNAL_KEYS.some((key) => values[key] !== null);
  return (
    <section className="score-summary" aria-label={copy.scoreLabel}>
      {anyValue ? (
        <div className="score-grid">
          {SIGNAL_KEYS.map((key) => {
            const value = values[key];
            const label = labels[key];
            return (
              <div className="score-row" key={key}>
                <h3>{label}</h3>
                <strong>{value === null ? '-' : String(value)}</strong>
                {value !== null ? (
                  <progress
                    max={100}
                    value={Math.max(0, Math.min(100, value))}
                    aria-label={label}
                  />
                ) : (
                  <span className="score-row__missing">{copy.noReasonRecorded}</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="score-summary__empty">
          {SIGNAL_KEYS.map((key) => (
            <h3 key={key}>{labels[key]}</h3>
          ))}
          <p>{copy.detailNoScore}</p>
        </div>
      )}
    </section>
  );
}
