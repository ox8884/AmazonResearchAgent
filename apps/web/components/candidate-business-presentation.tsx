import type {
  ResearchBusinessAssessment,
  ResearchBusinessEvidence,
  ResearchBusinessStage,
  ResearchBusinessSettings
} from '@ara/shared';

const stageLabels: Readonly<Record<ResearchBusinessStage, string>> = {
  basic_check: '기본 확인', market_validation: '시장 검증', quote_ready: '견적 초안 준비', awaiting_quote: '견적 회신 대기',
  awaiting_sample: '샘플 확인 대기', purchase_review: '발주 검토', hold: '보류', reject: '제외'
};

const gapLabels: Readonly<Record<string, string>> = {
  business_evidence: '상업 근거가 아직 기록되지 않았습니다.', brand_fit: '브랜드 적합성 확인이 필요합니다.', sale_price: '판매가가 미확인입니다.',
  amazon_unit_costs: 'Amazon 단위 비용이 미확인입니다.', market_check: '시장 검증이 미확인입니다.', selected_quote: '선택한 견적이 없습니다.',
  landed_unit_cost: '도착 단가가 미확인입니다.', launch_cash: '총 출시 현금이 미확인입니다.', launch_cash_exceeds_budget: '출시 현금이 현재 예산을 초과합니다.',
  unit_contribution: '광고 후 단위 기여이익이 미확인입니다.', profitability_targets_not_met: '현재 마진·ROI 목표를 충족하지 않습니다.',
  quote_incoterm: '견적 Incoterm이 미확인입니다.', quote_destination: '도착지가 미확인입니다.', quote_lead_time: '리드타임이 미확인입니다.',
  landed_shipment_total: '총 도착 비용이 미확인입니다.', landed_cost_coverage: '도착 비용 포함 범위가 완전하지 않습니다.', quote_validity: '견적 유효기간이 미확인입니다.',
  quote_expired: '견적 유효기간이 지났습니다.', sample_check: '샘플 확인이 필요합니다.', safety_ip_check: '안전·IP 확인이 필요합니다.'
};

function usd(value: number | null): string {
  return value === null ? '미확인' : new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'USD' }).format(value);
}

function percentage(value: number): string {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value);
}

function nextAction(assessment: ResearchBusinessAssessment): { readonly href: string; readonly label: string } {
  if (assessment.gaps.includes('market_check')) return { href: '#business-market', label: '시장 검증 기록' };
  if (assessment.gaps.includes('selected_quote') || assessment.gaps.includes('launch_cash')) return { href: '#business-quote', label: '견적·출시 비용 입력' };
  if (assessment.stage === 'awaiting_quote') return { href: '#business-quote', label: '견적 회신 기록' };
  if (assessment.stage === 'awaiting_sample') return { href: '#business-market', label: '샘플 확인 기록' };
  return { href: '#business-specification', label: '상업 근거 보완' };
}

export type CandidateBusinessResult = {
  readonly evidence: ResearchBusinessEvidence | null;
  readonly assessment: ResearchBusinessAssessment;
};

export function BusinessAssessment({ result, onCopyDraft }: { readonly result: CandidateBusinessResult; readonly onCopyDraft: (() => void) | null }) {
  const { assessment, evidence } = result;
  const action = nextAction(assessment);
  const source = evidence?.selectedQuote?.source ?? evidence?.salePrice.source;
  return <section className="business-assessment" aria-labelledby="business-assessment-title">
    <div className="section-heading"><h3 id="business-assessment-title">현재 상업 판단</h3><span className="status status--tone-waiting">{stageLabels[assessment.stage]}</span></div>
    <dl className="business-assessment__metrics">
      <div><dt>예상 출시 현금</dt><dd>{usd(assessment.estimatedLaunchCashUsd)}</dd></div>
      <div><dt>광고 후 단위 기여이익</dt><dd>{usd(assessment.estimatedUnitContributionUsd)}</dd></div>
      <div><dt>광고 후 마진</dt><dd>{assessment.estimatedMarginPct === null ? '미확인' : `${percentage(assessment.estimatedMarginPct)}%`}</dd></div>
    </dl>
    <p className="business-assessment__formula">광고 전 마진은 판매가 기준에서 단위 광고비를 더해 계산하고, 광고 후 마진은 판매가 기준 단위 기여이익입니다. ROI는 광고 후 단위 기여이익 ÷ 도착 단가이며 출시 현금 수익률이 아닙니다.</p>
    <dl className="business-assessment__settings"><div><dt>적용 출시 예산</dt><dd>{usd(assessment.settings.launchBudgetUsd)}</dd></div><div><dt>광고 전 목표</dt><dd>{percentage(assessment.settings.minimumPreAdMarginPct)}%</dd></div><div><dt>광고 후 목표</dt><dd>{percentage(assessment.settings.minimumPostAdMarginPct)}%</dd></div><div><dt>ROI 목표</dt><dd>{percentage(assessment.settings.minimumRoiPct)}%</dd></div></dl>
    <p className="business-assessment__formula">35%/150%는 편집 가능한 시작 목표이며 자동 통과나 발주 승인이 아닙니다.</p>
    {assessment.gaps.length > 0 ? <ul className="business-assessment__gaps">{assessment.gaps.map((gap) => <li key={gap}>{gapLabels[gap] ?? `추가 확인 필요: ${gap}`}</li>)}</ul> : null}
    <p className="notice">구매·발주 승인은 자동으로 생성되지 않습니다. {source?.url ? <a href={source.url} target="_blank" rel="noreferrer">기록된 출처 링크</a> : '출처 링크도 아직 기록되지 않았습니다.'}</p>
    <div className="button-row"><a className="button button--secondary" href={action.href}>{action.label}</a>{assessment.stage === 'quote_ready' && onCopyDraft !== null ? <button className="button button--primary" type="button" onClick={onCopyDraft}>RFQ 초안 복사</button> : null}</div>
  </section>;
}

export function BusinessSettingsExplanation({ settings }: { readonly settings: ResearchBusinessSettings }) {
  return <p className="field-help">Jungle Scout API 호출 한도와 별개로 적용되는 현재 기준입니다. 저장한 같은 근거도 이 네 값이 바뀌면 재평가됩니다: 예산 {usd(settings.launchBudgetUsd)}, 광고 전 {percentage(settings.minimumPreAdMarginPct)}%, 광고 후 {percentage(settings.minimumPostAdMarginPct)}%, ROI {percentage(settings.minimumRoiPct)}%.</p>;
}
