import { getCopy } from '@ara/shared';
import { ButtonLink } from '../../../components/ui';
import { localizedHref, parseLocale } from '../../../lib/locale';
import { getResearchSettingsView } from '../../../lib/server/dashboard-data';
import { requireAdminPage } from '../../../lib/server/admin-page-auth';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  await requireAdminPage(locale);
  const copy = getCopy(locale);
  const settings = await getResearchSettingsView();
  const configuredLocale = settings?.locale === 'ko' ? copy.languageKorean : copy.languageEnglish;
  const newPercent = settings?.newPercent ?? 60;
  const watchPercent = settings?.watchPercent ?? 30;
  const strongPercent = settings?.strongPercent ?? 10;
  return (
    <div className="content-stack">
      <header className="page-heading page-heading--split">
        <div>
          <h1>{copy.settingsTitle}</h1>
          <p>{copy.settingsReadOnly}</p>
        </div>
        <ButtonLink href={localizedHref(locale, '/settings/ai')} variant="secondary">
          {copy.navAiSettings}
        </ButtonLink>
      </header>
      <section className="panel settings-panel" aria-labelledby="settings-summary-title">
        <h2 id="settings-summary-title">{copy.settingsTitle}</h2>
        <dl className="settings-list">
          <div>
            <dt>{copy.settingsLocale}</dt>
            <dd>{settings ? configuredLocale : copy.dataUnavailable}</dd>
          </div>
          <div>
            <dt>{copy.settingsTimezone}</dt>
            <dd>{settings?.timezone ?? 'America/Chicago'}</dd>
          </div>
          <div>
            <dt>{copy.settingsAllocation}</dt>
            <dd className="allocation-list">
              <span>{copy.uniqueKeywords}: {newPercent}%</span>
              <span>{copy.waitingLabel}: {watchPercent}%</span>
              <span>{copy.acceptedLabel}: {strongPercent}%</span>
              <progress max={100} value={newPercent} aria-label={`${copy.uniqueKeywords} ${newPercent}%`} />
            </dd>
          </div>
          <div>
            <dt>{copy.apiBudgetLabel}</dt>
            <dd>
              {settings?.dailyApiBudget ?? 0}{' '}
              {locale === 'ko' ? '호출/일' : 'requests/day'}
            </dd>
            <p>
              {locale === 'ko'
                ? '이 값은 API 호출 건수의 하루 한도입니다. 총 상품 출시 예산 $3,000과는 별도이며, 앱에 자동 적용되는지는 아직 확인되지 않았습니다.'
                : 'This is a daily limit for API request count. It is separate from the $3,000 total product-launch budget, and automatic application in the app has not been confirmed.'}
            </p>
          </div>
          <div>
            <dt>{copy.settingsManualReserve}</dt>
            <dd>{settings?.manualReserveEnabled ? copy.providerActive : copy.providerDisabled}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
