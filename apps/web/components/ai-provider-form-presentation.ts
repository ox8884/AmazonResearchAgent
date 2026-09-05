import { AiRoleSchema, type AiRole, type Locale } from '@ara/shared';
import type {
  CopyDictionary,
  SavedProvider,
  SubscriptionProvider
} from './ai-provider-form-model';

const ROLE_PRESENTATION: Readonly<Record<AiRole, Readonly<Record<Locale, readonly [string, string]>>>> = {
  bulk_classification: { ko: ['대량 분류', '많은 후보를 같은 기준으로 1차 분류합니다.'], en: ['Bulk classification', 'Sorts many candidates using the same first-pass criteria.'] },
  niche_normalization: { ko: ['니치 정규화', '키워드와 상품 데이터를 비교 가능한 형식으로 정리합니다.'], en: ['Niche normalization', 'Turns keyword and product data into a comparable format.'] },
  deep_market_analysis: { ko: ['심층 시장 분석', '수요·경쟁·수익성 근거를 깊게 검토합니다.'], en: ['Deep market analysis', 'Reviews demand, competition, and profitability evidence in depth.'] },
  strong_cross_validation: { ko: ['강한 교차 검증', '다른 provider의 결과를 독립적으로 재검토합니다.'], en: ['Strong cross-validation', 'Independently rechecks another provider’s result.'] },
  review_mining: { ko: ['리뷰 분석', '고객 리뷰에서 반복되는 문제와 요구를 찾습니다.'], en: ['Review mining', 'Finds recurring customer problems and needs in reviews.'] },
  supplier_negotiation: { ko: ['공급업체 협상', '견적·MOQ·납품 조건을 정리합니다.'], en: ['Supplier negotiation', 'Organizes quotes, MOQ, and delivery terms.'] },
  daily_digest: { ko: ['일일 요약', '하루의 리서치 변화와 다음 조치를 요약합니다.'], en: ['Daily digest', 'Summarizes daily research changes and next actions.'] }
};

const MACHINE_NAME_PATTERN = /(http-integration-|http-normalizer-|settings-provider-)/i;

export function rolePresentation(locale: Locale, role: AiRole): readonly [string, string] {
  return ROLE_PRESENTATION[role][locale];
}

export function roleSummary(locale: Locale, provider: SavedProvider): string {
  const role = provider.product === 'openai_compatible_api'
    ? provider.roles[0]
    : provider.role;
  if (!role) return '';
  const parsed = AiRoleSchema.safeParse(role);
  if (!parsed.success) return role;
  const [label] = rolePresentation(locale, parsed.data);
  const remaining = provider.product === 'openai_compatible_api' ? provider.roles.length - 1 : 0;
  return remaining > 0 ? `${label} +${remaining}` : label;
}

export function displayIdentity(provider: SavedProvider): { readonly label: string; readonly fallback: boolean } {
  const machineGenerated = MACHINE_NAME_PATTERN.test(provider.name) ||
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(provider.name);
  if (!machineGenerated) return { label: provider.name, fallback: false };
  const role = provider.product === 'openai_compatible_api' ? provider.roles[0] : provider.role;
  return { label: [provider.productLabel, role].filter(Boolean).join(' · '), fallback: true };
}

export function billingShort(provider: SavedProvider, copy: CopyDictionary): string {
  if (provider.billingType === 'payg') return 'PAYG';
  if (provider.billingType === 'free') return 'Free';
  return copy.subscriptionLabel;
}

export function subscriptionStatusLabel(provider: SubscriptionProvider, copy: CopyDictionary): string {
  if (provider.setupStatus === 'ready') return copy.connectionReady;
  if (provider.setupStatus === 'expired') return copy.authorizationExpired;
  if (provider.setupStatus === 'disabled') return copy.providerDisabled;
  if (provider.setupStatus === 'needs_attention') return copy.needsAttentionLabel;
  if (provider.setupStatus === 'unavailable') return copy.connectionUnavailable;
  if (provider.statusReason === 'probe_pending') return copy.probePending;
  if (provider.statusReason === 'temporarily_unavailable') return copy.temporarilyUnavailable;
  return copy.setupRequired;
}

export function subscriptionStatusTone(provider: SubscriptionProvider): 'neutral' | 'accent' | 'waiting' | 'strong' | 'reject' {
  if (provider.setupStatus === 'ready') return 'strong';
  if (provider.setupStatus === 'disabled') return 'neutral';
  return 'waiting';
}
