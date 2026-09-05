import type { Locale } from '@ara/shared';
import type { CandidateEvidenceView, EvidenceGap, EvidenceStatus } from './candidate-evidence';

const STATUS: Record<EvidenceStatus, readonly [string, string]> = {
  none: ['수집된 자료 없음', 'No collected evidence'],
  partial: ['일부 자료 수집됨', 'Evidence partly collected'],
  missing_required: ['필수 확인이 남아 있습니다', 'Required checks remain'],
  reviewable: ['분석 검토 자료 충족 · 발주 승인 아님', 'Ready for analysis review · not purchase approval']
};
const GAPS: Record<EvidenceGap, readonly [string, string]> = {
  sale_price: ['실제 판매가', 'Observed sale price'],
  amazon_fees: ['Amazon 수수료', 'Amazon fees'],
  review_text: ['리뷰 원문 근거', 'Review-text evidence'],
  analysis: ['분석 결과', 'Recorded analysis'],
  verified_economics: ['공급업체 확인 수익성 자료', 'Supplier-verified economics']
};
const KINDS: Readonly<Record<string, readonly [string, string]>> = {
  keyword_metrics: ['월 검색량', 'Monthly search volume'],
  relevant_asins: ['비교 상품', 'Comparable products'],
  historical_search_volume: ['검색량 추이', 'Search-volume history'],
  historical_search_volume_analysis: ['수요·계절성 분석', 'Demand and seasonality analysis'],
  sales_estimates: ['판매 추정 자료', 'Sales estimates'],
  sales_estimates_analysis: ['판매·가격 안정성 분석', 'Sales and price stability analysis'],
  share_of_voice: ['검색 노출 점유 자료', 'Share-of-voice evidence'],
  share_of_voice_analysis: ['브랜드 집중도 분석', 'Brand concentration analysis'],
  economics: ['추정 수익성 입력', 'Estimated economics inputs'],
  economics_verified: ['확인된 수익성 입력', 'Verified economics inputs'],
  review_text: ['리뷰 원문 근거', 'Review-text evidence'],
  micro_niches: ['세부 니치', 'Micro-niches'],
  analysis_verdict: ['분석 결과', 'Recorded analysis']
};

export function evidenceKindLabel(kind: string, locale: Locale): string {
  return KINDS[kind]?.[locale === 'ko' ? 0 : 1] ?? kind;
}

export function evidenceGapLabel(gap: EvidenceGap, locale: Locale): string {
  return GAPS[gap][locale === 'ko' ? 0 : 1];
}

export function evidencePresentation(view: CandidateEvidenceView, locale: Locale) {
  const ko = locale === 'ko';
  if (view.kind === 'unavailable') return {
    state: 'unavailable', label: ko ? '근거 조회 불가' : 'Evidence unavailable',
    collected: ko ? '자료 유무를 확인하지 못했습니다.' : 'Evidence availability could not be checked.',
    missing: ko ? '잠시 후 다시 조회해 주세요.' : 'Please reload to try again.'
  };
  if (view.completeness === 'truncated') return {
    state: 'truncated', label: ko ? '일부 기록만 조회됨' : 'Evidence read is incomplete',
    collected: ko ? '최근 200개 기록만 표시합니다.' : 'Showing the latest 200 records only.',
    missing: ko ? '전체 기록 확인 전에는 부족·충족을 확정하지 않습니다.' : 'Read the remaining records before judging completeness.'
  };
  const { summary } = view;
  const unparsed = summary.status === 'none' && view.records.length > 0;
  return {
    state: unparsed ? 'unparsed' : summary.status,
    label: unparsed ? (ko ? '자료 해석 확인 필요' : 'Evidence needs interpretation') : STATUS[summary.status][ko ? 0 : 1],
    collected: summary.collectedKinds.length > 0
      ? summary.collectedKinds.map((kind) => evidenceKindLabel(kind, locale)).join(' · ')
      : unparsed ? (ko ? '원본 기록은 있으나 요약할 수 없습니다.' : 'Raw records exist but could not be summarized.')
        : (ko ? '이 후보에 저장된 조사 자료가 없습니다.' : 'No research evidence is stored for this candidate.'),
    missing: summary.gaps.length > 0
      ? (ko ? '미확인: ' : 'Unconfirmed: ') + summary.gaps.map((gap) => evidenceGapLabel(gap, locale)).join(' · ')
      : (ko ? '발주 전 견적·운송비·출시 예산·샘플·권리 검토가 별도로 필요합니다.' : 'Supplier quote, freight, launch budget, samples and rights still need purchase validation.')
  };
}

export function analysisReasonLabel(reason: string, locale: Locale): string {
  if (locale !== 'ko') return reason;
  switch (reason) {
    case 'Margin is provisional without supplier-verified landed cost':
      return '공급업체가 확인한 도착 원가가 없어 마진은 잠정치입니다.';
    case 'Differentiation evidence mode is missing':
      return '차별화를 판단할 리뷰 원문 근거가 없습니다.';
    case 'Differentiation evidence mode is listing_proxy':
      return '차별화 판단에 리뷰 원문 대신 간접 자료가 사용됐습니다.';
    default: return reason;
  }
}
