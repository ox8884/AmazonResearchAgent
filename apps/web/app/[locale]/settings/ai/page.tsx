import { getCopy } from '@ara/shared';
import { AiProviderForm } from '../../../../components/ai-provider-form';
import { parseLocale } from '../../../../lib/locale';

export default async function AiSettingsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  const copy = getCopy(locale);

  return (
    <div className="content-stack content-stack--narrow">
      <header className="page-heading">
        <h1>{copy.aiSettingsTitle}</h1>
        <p>{copy.aiSettingsDescription}</p>
      </header>
      <section className="panel panel--form" aria-labelledby="provider-form-title">
        <h2 className="visually-hidden" id="provider-form-title">{copy.aiSettingsTitle}</h2>
        <AiProviderForm locale={locale} />
      </section>
    </div>
  );
}
