import { getCopy } from '@ara/shared';
import { ButtonLink, EmptyState, localeDate, LocalizedStatusBadge } from '../../../components/ui';
import { localizedHref, parseLocale } from '../../../lib/locale';
import { getImportsView } from '../../../lib/server/dashboard-data';
import { formatCount } from '../../../lib/dashboard-metrics';
import { requireAdminPage } from '../../../lib/server/admin-page-auth';

export const dynamic = 'force-dynamic';

export default async function ImportsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  await requireAdminPage(locale);
  const copy = getCopy(locale);
  const importsView = await getImportsView();
  const imports = importsView.imports;
  // Recorded timestamps of the visible imports. When more than one record
  // shares the same rendered timestamp, one note explains that these are
  // separate import records and that the ordinal is a list position, not a
  // source identifier.
  const seenDates = new Map<string, number>();
  for (const importRun of imports) {
    const rendered = localeDate(importRun.created_at, locale);
    seenDates.set(rendered, (seenDates.get(rendered) ?? 0) + 1);
  }
  const hasRepeatedTimestamps = Array.from(seenDates.values()).some((count) => count > 1);

  return (
    <div className="content-stack">
      <header className="page-heading page-heading--split">
        <div>
          <h1>{copy.importsTitle}</h1>
          <p>{copy.importsProvenanceNote}</p>
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
        {hasRepeatedTimestamps ? (
          <p className="imports-timestamp-note">{copy.importTimestampNote}</p>
        ) : null}
        {imports.length === 0 ? (
          <div className="empty-block">
            <EmptyState>{copy.noImports}</EmptyState>
            <ButtonLink href={localizedHref(locale, '/imports/new')} variant="secondary">
              {copy.newImport}
            </ButtonLink>
          </div>
        ) : (
          <div className="import-list">
            {imports.map((importRun, index) => (
              <article
                className={`import-row${index === 0 ? ' import-row--latest' : ''}`}
                key={importRun.id}
              >
                <div className="import-row__primary">
                  <p className="import-row__title">
                    {index === 0 ? <span className="import-row__fresh">{copy.importsFreshness}</span> : null}
                    {localeDate(importRun.created_at, locale)}
                  </p>
                  {/* Visible safe differentiator: a stable record ordinal.
                      It marks this row's position among separate records —
                      explicitly not a source identifier. */}
                  <p className="import-row__ordinal">
                    {copy.importRecordOrdinal.replace('{ordinal}', String(index + 1))}
                  </p>
                  <p className="import-row__summary">
                    {formatCount(copy.importsRecordSummary, 0)
                      .replace('{files}', String(importRun.file_count))
                      .replace('{rows}', String(importRun.total_row_count))
                      .replace('{keywords}', String(importRun.unique_keyword_count))}
                  </p>
                </div>
                <LocalizedStatusBadge status={importRun.status} locale={locale} />
                <dl className="import-row__counts">
                  <div><dt>{copy.uniqueKeywords}</dt><dd>{importRun.unique_keyword_count}</dd></div>
                  <div><dt>{copy.duplicateKeywords}</dt><dd>{importRun.duplicate_keyword_count}</dd></div>
                </dl>
                <details className="import-row__technical">
                  <summary>{copy.importIdLabel}</summary>
                  <code>{importRun.id}</code>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
