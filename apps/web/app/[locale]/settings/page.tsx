import { getCopy } from '@ara/shared';
import { ButtonLink } from '../../../components/ui';
import { ResearchBusinessSettingsForm } from '../../../components/research-business-settings-form';
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
          <p>{locale === 'ko' ? '일반 운영 설정은 읽기 전용입니다. 아래 출시 예산·수익성 기준은 관리자만 저장할 수 있으며, 후보가 자체 목표를 덮어쓰지 않습니다.' : 'General operating settings are read-only. Administrators can save the commercial targets below; candidates cannot override them.'}</p>
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
                ? '이 값은 API 호출 건수의 하루 한도입니다. 아래 출시 예산·수익성 기준과 별도이며, 후보별 요청 의도를 저장해도 즉시 API를 호출하지 않고 다음 수동·예약 리서치에서 조건을 확인합니다.'
                : 'This is a daily limit for API request count. It is separate from the commercial launch-budget, margin and ROI targets below; saving a candidate request intent does not call an API immediately, and the next manual or scheduled research checks it.'}
            </p>
          </div>
          <div>
            <dt>{copy.settingsManualReserve}</dt>
            <dd>{settings?.manualReserveEnabled ? copy.providerActive : copy.providerDisabled}</dd>
          </div>
        </dl>
      </section>
      <section className="panel panel--form" aria-labelledby="business-settings-title">
        <div className="section-heading"><h2 id="business-settings-title">{locale === 'ko' ? '출시 예산·수익성 기준' : 'Commercial research targets'}</h2></div>
        <ResearchBusinessSettingsForm />
      </section>
    </div>
  );
}
