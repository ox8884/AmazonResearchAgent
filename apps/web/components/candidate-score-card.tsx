import { getCopy, type Locale } from '@ara/shared';

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
  const rows = [
    [copy.competitionLabel, competition],
    [copy.demandLabel, demand],
    [copy.marginLabel, margin],
    [copy.differentiationLabel, differentiation]
  ] as const;
  const format = (value: number | null): string => value === null ? '—' : String(value);
  return (
    <section className="panel score-panel" aria-label={copy.scoreLabel}>
      <div className="score-grid">
        {rows.map(([label, value]) => (
          <div className="score-row" key={label}>
            <span>{label}</span>
            <strong>{format(value)}</strong>
            <progress max={100} value={value === null ? 0 : Math.max(0, Math.min(100, value))} aria-label={label} />
          </div>
        ))}
      </div>
    </section>
  );
}
