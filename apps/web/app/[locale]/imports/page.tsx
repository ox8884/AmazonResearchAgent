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
          <div className="empty-block">
            <EmptyState>{copy.noImports}</EmptyState>
            <ButtonLink href={localizedHref(locale, '/imports/new')} variant="secondary">
              {copy.newImport}
            </ButtonLink>
          </div>
        ) : (
          <div className="import-list">
            {imports.map((importRun) => (
              <article className="import-row" key={importRun.id}>
                <div>
                  <p className="import-row__title">{localeDate(importRun.created_at, locale)}</p>
                  <p className="import-row__meta">{importRun.id}</p>
                </div>
                <LocalizedStatusBadge status={importRun.status} locale={locale} />
                <dl className="import-row__counts">
                  <div><dt>{copy.fileCount}</dt><dd>{importRun.file_count}</dd></div>
                  <div><dt>{copy.rowCount}</dt><dd>{importRun.total_row_count}</dd></div>
                  <div><dt>{copy.uniqueKeywords}</dt><dd>{importRun.unique_keyword_count}</dd></div>
                  <div><dt>{copy.duplicateKeywords}</dt><dd>{importRun.duplicate_keyword_count}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
