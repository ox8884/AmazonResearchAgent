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
  const format = (value: number | null): string =>
    value === null ? '—' : String(value);
  return (
    <section className="metric-grid" aria-label={copy.scoreLabel}>
      <article className="metric-card">
        <p className="metric-card__label">{copy.competitionLabel}</p>
        <p className="metric-card__value">{format(competition)}</p>
      </article>
      <article className="metric-card">
        <p className="metric-card__label">{copy.demandLabel}</p>
        <p className="metric-card__value">{format(demand)}</p>
      </article>
      <article className="metric-card">
        <p className="metric-card__label">{copy.marginLabel}</p>
        <p className="metric-card__value">{format(margin)}</p>
      </article>
      <article className="metric-card">
        <p className="metric-card__label">{copy.differentiationLabel}</p>
        <p className="metric-card__value">{format(differentiation)}</p>
      </article>
    </section>
  );
}
