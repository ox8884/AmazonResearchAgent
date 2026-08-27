import { getCopy } from '@ara/shared';
import { ButtonLink, EmptyState, MetricCard, StatusBadge } from '../../../components/ui';
import { localizedHref, parseLocale } from '../../../lib/locale';

export default async function ShowcasePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  const copy = getCopy(locale);
  return (
    <div className="content-stack">
      <header className="page-heading">
        <h1>{copy.showcaseTitle}</h1>
        <p>{copy.homeDescription}</p>
      </header>

      <section className="showcase-section" aria-labelledby="actions-title">
        <h2 id="actions-title">{copy.showcaseActions}</h2>
        <div className="wrap-row">
          <ButtonLink href={localizedHref(locale, '/imports/new')}>
            {copy.newImport}
          </ButtonLink>
          <ButtonLink href={localizedHref(locale, '/imports')} variant="secondary">
            {copy.returnToImports}
          </ButtonLink>
          <button className="button button--primary" disabled>{copy.uploadingFiles}</button>
        </div>
      </section>

      <section className="showcase-section" aria-labelledby="statuses-title">
        <h2 id="statuses-title">{copy.showcaseStatus}</h2>
        <div className="wrap-row">
          <StatusBadge status="queued" label={copy.importQueued} />
          <StatusBadge status="processing" label={copy.importProcessing} />
          <StatusBadge status="completed" label={copy.importCompleted} />
          <StatusBadge status="failed" label={copy.importFailed} />
        </div>
      </section>

      <section className="showcase-section" aria-labelledby="metrics-title">
        <h2 id="metrics-title">{copy.showcaseMetrics}</h2>
        <div className="metric-grid">
          <MetricCard label={copy.totalImports} value={12} note="3 CSV" />
          <MetricCard label={copy.totalCandidates} value={284} note={copy.uniqueKeywords} />
          <MetricCard label={copy.rejectedLabel} value={79} note={copy.decisionReasonLabel} />
        </div>
      </section>

      <section className="showcase-section" aria-labelledby="form-title">
        <h2 id="form-title">{copy.showcaseStates}</h2>
        <div className="field-stack">
          <label htmlFor="showcase-file">{copy.uploadTitle}</label>
          <input id="showcase-file" type="file" accept=".csv,text/csv" multiple />
          <p className="field-help">{copy.uploadHelp}</p>
        </div>
        <EmptyState>{copy.noCandidates}</EmptyState>
        <p className="notice notice--error" role="alert">{copy.uploadError}</p>
      </section>
    </div>
  );
}
