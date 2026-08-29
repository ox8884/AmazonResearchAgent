import { getCopy, type Locale } from '@ara/shared';
import type { ApiBudgetMeter } from '../lib/server/dashboard-data';

export function ApiUsageMeter({
  locale,
  meter
}: {
  locale: Locale;
  meter: ApiBudgetMeter;
}) {
  const copy = getCopy(locale);
  return (
    <article className="metric-card">
      <p className="metric-card__label">{copy.apiBudgetLabel}</p>
      <p className="metric-card__value">
        {meter.used}/{meter.dailyLimit}
      </p>
      <p className="metric-card__note">reserve {meter.reservedLimit}</p>
    </article>
  );
}
