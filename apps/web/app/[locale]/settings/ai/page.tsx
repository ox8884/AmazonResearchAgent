import { getCopy } from '@ara/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminLogoutButton } from '../../../../components/admin-logout-button';
import { AiProviderForm } from '../../../../components/ai-provider-form';
import {
  AdminCookieNames,
  getSessionSigningKey,
  verifyAdminSession
} from '../../../../lib/server/admin-session';
import { parseLocale } from '../../../../lib/locale';

export default async function AiSettingsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  const copy = getCopy(locale);
  const cookieStore = await cookies();
  const token = cookieStore.get(AdminCookieNames.session)?.value;
  let authenticated = false;
  if (token) {
    try {
      authenticated = verifyAdminSession(token, getSessionSigningKey()) !== null;
    } catch {
      authenticated = false;
    }
  }
  if (!authenticated) {
    redirect(`/${locale}/login`);
  }

  return (
    <div className="content-stack">
      <header className="page-heading page-heading--split">
        <div>
          <h1>{copy.aiSettingsTitle}</h1>
          <p>{copy.aiSettingsDescription}</p>
        </div>
        <AdminLogoutButton locale={locale} />
      </header>
      <section className="panel panel--form" aria-labelledby="provider-form-title">
        <h2 className="visually-hidden" id="provider-form-title">{copy.aiSettingsTitle}</h2>
        <AiProviderForm locale={locale} />
      </section>
    </div>
  );
}
