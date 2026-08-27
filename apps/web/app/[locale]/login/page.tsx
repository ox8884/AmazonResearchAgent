import { getCopy } from '@ara/shared';
import { AdminLoginForm } from '../../../components/admin-login-form';
import { parseLocale } from '../../../lib/locale';

export default async function LoginPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  const copy = getCopy(locale);
  return (
    <div className="content-stack content-stack--narrow">
      <header className="page-heading">
        <h1>{copy.adminLoginTitle}</h1>
      </header>
      <section className="panel panel--form" aria-label={copy.adminLoginTitle}>
        <AdminLoginForm locale={locale} />
      </section>
    </div>
  );
}
