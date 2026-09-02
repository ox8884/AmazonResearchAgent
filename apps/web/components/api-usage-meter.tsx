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
  const ratio = meter.dailyLimit > 0 ? Math.min(100, Math.round((meter.used / meter.dailyLimit) * 100)) : 0;
  return (
    <div className="budget-meter" aria-label={copy.apiBudgetLabel}>
      <div className="budget-meter__heading">
        <strong>{meter.used}/{meter.dailyLimit}</strong>
      </div>
      <progress max={100} value={ratio} aria-label={`${copy.apiBudgetLabel} ${ratio}%`} />
      <p className="metric-card__note">{copy.reserveLabel}: {meter.reservedLimit}</p>
    </div>
  );
}
