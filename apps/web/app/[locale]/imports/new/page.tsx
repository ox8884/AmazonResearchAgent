import { getCopy } from '@ara/shared';
import { ImportUploadForm } from '../../../../components/import-upload-form';
import { localizedHref, parseLocale } from '../../../../lib/locale';

export default async function NewImportPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  const copy = getCopy(locale);

  return (
    <div className="content-stack content-stack--narrow">
      <header className="page-heading">
        <h1>{copy.uploadTitle}</h1>
        <p>{copy.importsDescription}</p>
      </header>

      <section className="panel panel--form" aria-labelledby="upload-form-title">
        <h2 className="visually-hidden" id="upload-form-title">{copy.uploadTitle}</h2>
        <ImportUploadForm locale={locale} />
      </section>

      <a className="back-link" href={localizedHref(locale, '/imports')}>
        ← {copy.returnToImports}
      </a>
    </div>
  );
}
