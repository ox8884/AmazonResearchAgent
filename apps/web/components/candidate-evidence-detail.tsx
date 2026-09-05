import type { Locale } from '@ara/shared';
import { readableEvidencePayload, type CandidateEvidenceView, type EvidenceAnalysis } from '../lib/candidate-evidence';
import { analysisReasonLabel, evidenceGapLabel, evidenceKindLabel, evidencePresentation } from '../lib/evidence-copy';
import { EvidenceStatusNote } from './evidence-status-note';

function AnalysisDetail({ analysis, locale }: { readonly analysis: EvidenceAnalysis; readonly locale: Locale }) {
  const ko = locale === 'ko';
  const unknown = ko ? '미확인' : 'Unconfirmed';
  const percent = (value: number | null | undefined) => value == null ? unknown
    : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);
  const metrics = [
    [ko ? '검색량 일관성' : 'Search consistency', analysis.consistency],
    [ko ? '판매 안정성' : 'Sales stability', analysis.salesStability],
    [ko ? '가격 안정성' : 'Price stability', analysis.priceStability],
    [ko ? '상위 브랜드 노출 점유율' : 'Leading brand share of voice', analysis.brandDominance]
  ] as const;
  return (
    <article className="evidence-item">
      <h3>{evidenceKindLabel(analysis.source, locale)}</h3>
      <p>{analysis.observedOrEstimated === 'estimated' ? (ko ? '추정 자료' : 'Estimated data') : (ko ? '관측 자료' : 'Observed data')}
        {' · '}{ko ? '신뢰도' : 'Confidence'}: {analysis.confidence === 'high' ? (ko ? '높음' : 'High') : (ko ? '낮음' : 'Low')}</p>
      <p>{ko ? '자료 기간' : 'Source period'}: {analysis.sourcePeriod.from ?? unknown} – {analysis.sourcePeriod.to ?? unknown}</p>
      {analysis.quality !== 'ok' ? <p>{ko ? '자료 부족으로 분석에 제한이 있습니다.' : 'Limited source data constrains this analysis.'}</p> : null}
      <dl>
        {metrics.filter(([, value]) => value !== undefined).map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{percent(value)}</dd></div>
        ))}
        {analysis.seasonal !== undefined ? <div><dt>{ko ? '계절성 신호' : 'Seasonality signal'}</dt><dd>{analysis.seasonal === null ? unknown : analysis.seasonal ? (ko ? '있음' : 'Present') : (ko ? '없음' : 'Not detected')}</dd></div> : null}
        {analysis.topBrand !== undefined ? <div><dt>{ko ? '상위 브랜드' : 'Leading brand'}</dt><dd>{analysis.topBrand ?? unknown}</dd></div> : null}
      </dl>
    </article>
  );
}

export function CandidateEvidenceDetail({ view, locale }: { readonly view: CandidateEvidenceView; readonly locale: Locale }) {
  const ko = locale === 'ko';
  if (view.kind === 'unavailable') return <EvidenceStatusNote view={view} locale={locale} />;
  const { summary } = view;
  const money = (value: number | null) => value === null ? (ko ? '미확인' : 'Unconfirmed')
    : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);
  return (
    <>
      <section className="panel desk-review" aria-labelledby="evidence-summary-title">
        <div>
        <h2 id="evidence-summary-title">{ko ? '검토 요약' : 'Review brief'}</h2>
        <EvidenceStatusNote view={view} locale={locale} />
        {summary.reasons.length > 0 ? <ul>{summary.reasons.map((reason, index) => <li key={`${index}:${reason}`}>{analysisReasonLabel(reason, locale)}</li>)}</ul> : null}
        </div>
        <div className="desk-review__score"><span>{ko ? '분석 총점' : 'Analysis total'}</span><strong>{summary.analysisScore ?? '—'}<small>{summary.analysisScore !== null ? ' / 100' : ''}</small></strong><p>{ko ? '발주 승인이나 예상 이익이 아닙니다.' : 'Not purchase approval or projected profit.'}</p></div>
      </section>
      <div className="desk-columns">
      <section className="evidence-panel desk-sheet" aria-labelledby="market-evidence-title">
        <div className="section-heading"><h2 id="market-evidence-title">{ko ? '수요와 경쟁' : 'Demand and competition'}</h2></div>
        <dl className="desk-readings"><div><dt>{ko ? '월 검색량' : 'Monthly search volume'}</dt><dd>{summary.monthlySearchVolume === null ? '—' : new Intl.NumberFormat(locale).format(summary.monthlySearchVolume)}</dd><small>{ko ? '저장된 검색량 자료' : 'Recorded search data'}</small></div></dl>
        {summary.searchVolumeIsUpperBound ? <p>{ko ? '제공처가 상한값으로 표시한 검색량입니다.' : 'The source marks this search volume as an upper bound.'}</p> : null}
        <div className="evidence-list">{summary.analyses.map((analysis, index) => <AnalysisDetail key={`${analysis.source}:${index}`} analysis={analysis} locale={locale} />)}</div>
      </section>
      <aside className="desk-aside">
      <section className="evidence-panel desk-sheet" aria-labelledby="economics-title">
        <div className="section-heading"><h2 id="economics-title">{ko ? '수익성 확인' : 'Economics checks'}</h2></div>
        <article className="evidence-item"><dl>
          <div><dt>{ko ? '판매가' : 'Sale price'}</dt><dd>{money(summary.salePrice)}</dd></div>
          <div><dt>{ko ? 'Amazon 수수료' : 'Amazon fees'}</dt><dd>{money(summary.amazonFees)}</dd></div>
          <div><dt>{ko ? '공급가·DDP·광고비·예상 마진' : 'Supplier cost, DDP, advertising and projected margin'}</dt><dd>{ko ? '이 요약에서 확인되지 않음' : 'Not verified in this summary'}</dd></div>
        </dl></article>
        <p>{summary.economicsSource === 'supplier_verified' ? (ko ? '공급업체 확인 자료로 기록됨. 실제 견적과 적용 범위를 원문에서 확인하세요.' : 'Recorded as supplier-verified. Check the underlying quote and its scope.') : (ko ? '공급업체 확인 전입니다. 입력값이 있어도 추정과 확인값을 혼동하지 마세요.' : 'Supplier verification is pending. Estimated inputs are not confirmed costs.')}</p>
      </section>
      <section className="evidence-panel desk-sheet" aria-labelledby="missing-evidence-title">
        <div className="section-heading"><h2 id="missing-evidence-title">{ko ? '다음에 확인할 것' : 'Next checks'}</h2></div>
        {view.completeness === 'truncated' ? <p>{evidencePresentation(view, locale).missing}</p>
          : <ul>{summary.gaps.map((gap) => <li key={gap}>{evidenceGapLabel(gap, locale)}</li>)}</ul>}
        <p>{ko ? '견적·운송비·MOQ·총 출시 예산·샘플·권리 검토까지 확인한 뒤 발주를 결정하세요.' : 'Verify quotes, freight, MOQ, total launch budget, samples and rights before purchasing.'}</p>
      </section>
      </aside>
      </div>
      <details className="candidate-detail__technical">
        <summary>{ko ? '원본 자료와 수집 기록' : 'Raw evidence and collection records'} ({view.records.length})</summary>
        {view.records.map((record, index) => {
          const payload = readableEvidencePayload(record);
          return <details className="evidence-item" key={record.id ?? `${record.kind}:${index}`}>
          <summary>{evidenceKindLabel(record.kind, locale)} · {record.created_at ?? (ko ? '기록 시각 미확인' : 'Record time unavailable')}</summary>
          <p>{ko ? '기록 시각은 자료의 관측 기간과 다릅니다.' : 'Record time is not the source observation period.'}</p>
          <code>{record.kind}</code>
          <pre className="evidence-raw">{payload === null ? (ko ? '표시 가능한 조사 필드 없음' : 'No displayable research fields') : JSON.stringify(payload, null, 2)}</pre>
        </details>;
        })}
      </details>
    </>
  );
}
