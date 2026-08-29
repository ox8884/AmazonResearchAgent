import { getCopy } from '@ara/shared';
import { ButtonLink } from '../../../components/ui';
import { localizedHref, parseLocale } from '../../../lib/locale';
import { getResearchSettingsView } from '../../../lib/server/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  const copy = getCopy(locale);
  const settings = await getResearchSettingsView();
  return (
    <div className="content-stack">
      <header className="page-heading page-heading--split">
        <div>
          <h1>{copy.settingsTitle}</h1>
        </div>
        <ButtonLink href={localizedHref(locale, '/settings/ai')} variant="secondary">
          {copy.navAiSettings}
        </ButtonLink>
      </header>
      <section className="panel">
        <p>
          locale: {settings?.locale ?? copy.dataUnavailable}
        </p>
        <p>timezone: {settings?.timezone ?? 'America/Chicago'}</p>
        <p>
          allocation: {settings?.newPercent ?? 60}/{settings?.watchPercent ?? 30}/
          {settings?.strongPercent ?? 10}
        </p>
        <p>
          {copy.apiBudgetLabel}: {settings?.dailyApiBudget ?? 0}
        </p>
      </section>
    </div>
  );
}
