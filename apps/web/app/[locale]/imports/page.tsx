import { getCopy } from '@ara/shared';
import { ButtonLink, EmptyState, localeDate, LocalizedStatusBadge } from '../../../components/ui';
import { localizedHref, parseLocale } from '../../../lib/locale';
import { getImportsView } from '../../../lib/server/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function ImportsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  const copy = getCopy(locale);
  const importsView = await getImportsView();
  const imports = importsView.imports;

  return (
    <div className="content-stack">
      <header className="page-heading page-heading--split">
        <div>
          <h1>{copy.importsTitle}</h1>
          <p>{copy.importsDescription}</p>
        </div>
        <ButtonLink href={localizedHref(locale, '/imports/new')}>{copy.newImport}</ButtonLink>
      </header>


      {importsView.kind === 'unavailable' ? (
        <p className="notice notice--error" role="status">{copy.dataUnavailable}</p>
      ) : null}
      <section className="panel" aria-labelledby="imports-list-title">
        <div className="section-heading">
          <h2 id="imports-list-title">{copy.recentImports}</h2>
          <span className="section-count">{imports.length}</span>
        </div>
        {imports.length === 0 ? (
          <EmptyState>{copy.noImports}</EmptyState>
        ) : (
          <div className="import-list">
            {imports.map((importRun) => (
              <article className="import-row" key={importRun.id}>
                <div>
                  <p className="import-row__title">{importRun.id}</p>
                  <p className="import-row__meta">{localeDate(importRun.created_at, locale)}</p>
                </div>
                <LocalizedStatusBadge status={importRun.status} locale={locale} />
                <div className="import-row__counts">
                  <span>{importRun.file_count} {copy.fileCount}</span>
                  <span>{importRun.total_row_count} {copy.rowCount}</span>
                  <span>{importRun.unique_keyword_count} {copy.uniqueKeywords}</span>
                  <span>{importRun.duplicate_keyword_count} {copy.duplicateKeywords}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
