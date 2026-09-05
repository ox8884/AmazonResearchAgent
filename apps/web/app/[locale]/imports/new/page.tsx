import { getCopy } from '@ara/shared';
import { ImportUploadForm } from '../../../../components/import-upload-form';
import { localizedHref, parseLocale } from '../../../../lib/locale';
import { requireAdminPage } from '../../../../lib/server/admin-page-auth';

export default async function NewImportPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  await requireAdminPage(locale);
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

      <section className="panel import-handoff" aria-labelledby="import-handoff-title">
        <div className="section-heading"><h2 id="import-handoff-title">{locale === 'ko' ? '웹 리서치 인계' : 'Web research handoff'}</h2></div>
        <ul>
          <li>{locale === 'ko' ? 'Opportunity Finder CSV는 위 기존 업로드로 원본과 product family provenance를 보존해 가져옵니다.' : 'Use the existing upload above for Opportunity Finder CSVs so raw rows and product-family provenance stay intact.'}</li>
          <li>{locale === 'ko' ? 'Top Products 메모는 출처 근거로 기록하며, CSV에 없던 열을 만들어 넣지 않습니다.' : 'Record Top Products notes as source evidence; do not fabricate CSV columns.'}</li>
          <li>{locale === 'ko' ? '기록 시각과 제공처의 관측 기간은 다릅니다. 검색·공급처 링크는 검증된 판매자를 뜻하지 않습니다.' : 'Record time differs from the provider observation period. Search and supplier links are not verified sellers.'}</li>
        </ul>
      </section>

      <a className="back-link" href={localizedHref(locale, '/imports')}>
        ← {copy.returnToImports}
      </a>
    </div>
  );
}
