import { LocaleSchema, type Locale } from '@ara/shared';

export const NotificationEventType = {
  NEW_STRONG: 'NEW_STRONG',
  WATCH_TO_STRONG: 'WATCH_TO_STRONG',
  MAJOR_STATE_CHANGE: 'MAJOR_STATE_CHANGE',
  NEEDS_ATTENTION: 'NEEDS_ATTENTION',
  DAILY_SUMMARY: 'DAILY_SUMMARY'
} as const;

export type NotificationEventType =
  (typeof NotificationEventType)[keyof typeof NotificationEventType];

export type DigestEvent = {
  readonly type: NotificationEventType | string;
  readonly summary: string;
};

export type DigestCandidate = {
  readonly title: string;
  readonly state: string;
  readonly score?: number;
  readonly price?: number;
  readonly monthlySales?: number;
  readonly reviews?: number;
  readonly competition?: number;
  readonly demand?: number;
  readonly margin?: number;
  readonly differentiation?: number;
};

export type DailyDigestSnapshot = {
  readonly logicalRunDate: string;
  readonly importedKeywords: number;
  readonly normalizedNiches?: number;
  readonly candidatesEvaluated: number;
  readonly strong: number;
  readonly watch: number;
  readonly reject: number;
  readonly needsAttention: number;
  readonly deepResearch?: number;
  readonly topCandidates: readonly DigestCandidate[];
  readonly jungleScoutUsed: number;
  readonly jungleScoutBudget: number;
  readonly reservedUsed?: number;
  readonly reservedBudget?: number;
  readonly aiAnalyses?: number;
  readonly runIdShort: string;
  readonly nextRunLabel?: string;
};

export type DailyDigestData = {
  readonly events: readonly DigestEvent[];
  readonly snapshot?: DailyDigestSnapshot;
};

const HEADING: Record<Locale, string> = {
  ko: '오늘의 Amazon 리서치 요약',
  en: 'Today’s Amazon research summary'
};

function countLine(locale: Locale, labelKo: string, labelEn: string, value: number): string {
  return locale === 'ko' ? `• ${labelKo}: ${value}개` : `• ${labelEn}: ${value}`;
}

function formatPrice(price: number): string {
  return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
}

function renderCandidate(candidate: DigestCandidate, index: number, locale: Locale): string[] {
  const lines = [`${index + 1}. ${candidate.title}`];
  lines.push(locale === 'ko' ? `• 상태: ${candidate.state}` : `• Status: ${candidate.state}`);
  if (candidate.price !== undefined) {
    lines.push(locale === 'ko' ? `• 가격: ${formatPrice(candidate.price)}` : `• Price: ${formatPrice(candidate.price)}`);
  }
  if (candidate.monthlySales !== undefined) {
    lines.push(
      locale === 'ko' ? `• 월 판매량: ${candidate.monthlySales}` : `• Monthly sales: ${candidate.monthlySales}`
    );
  }
  if (candidate.reviews !== undefined) {
    lines.push(locale === 'ko' ? `• 리뷰: ${candidate.reviews}` : `• Reviews: ${candidate.reviews}`);
  }
  if (candidate.score !== undefined) {
    lines.push(
      locale === 'ko' ? `• 종합 점수: ${candidate.score}/100` : `• Score: ${candidate.score}/100`
    );
  }
  if (candidate.competition !== undefined) {
    lines.push(locale === 'ko' ? `• 경쟁도: ${candidate.competition}` : `• Competition: ${candidate.competition}`);
  }
  if (candidate.demand !== undefined) {
    lines.push(locale === 'ko' ? `• 수요: ${candidate.demand}` : `• Demand: ${candidate.demand}`);
  }
  if (candidate.margin !== undefined) {
    lines.push(locale === 'ko' ? `• 마진: ${candidate.margin}` : `• Margin: ${candidate.margin}`);
  }
  if (candidate.differentiation !== undefined) {
    lines.push(
      locale === 'ko'
        ? `• 차별화: ${candidate.differentiation}`
        : `• Differentiation: ${candidate.differentiation}`
    );
  }
  return lines;
}

function renderSnapshot(snapshot: DailyDigestSnapshot, locale: Locale): string[] {
  const lines = [HEADING[locale], snapshot.logicalRunDate, ''];
  const empty = snapshot.topCandidates.length === 0 && snapshot.strong === 0 && snapshot.watch === 0;
  if (empty) {
    lines.push(locale === 'ko' ? '오늘 조건을 만족한 후보가 없습니다.' : 'No candidates met today’s criteria.');
    lines.push('');
  }
  lines.push(locale === 'ko' ? '🔎 분석 결과' : '🔎 Results');
  lines.push(countLine(locale, '수집 키워드', 'Imported keywords', snapshot.importedKeywords));
  if (snapshot.normalizedNiches !== undefined) {
    lines.push(countLine(locale, '정규화 니치', 'Normalized niches', snapshot.normalizedNiches));
  }
  lines.push(countLine(locale, '검증 후보', 'Candidates evaluated', snapshot.candidatesEvaluated));
  lines.push(countLine(locale, 'Strong', 'Strong', snapshot.strong));
  lines.push(countLine(locale, 'Watch', 'Watch', snapshot.watch));
  if (snapshot.reject > 0 || !empty) {
    lines.push(countLine(locale, 'Reject', 'Reject', snapshot.reject));
  }
  if (snapshot.deepResearch !== undefined) {
    lines.push(countLine(locale, 'Deep Research', 'Deep Research', snapshot.deepResearch));
  }
  if (snapshot.topCandidates.length > 0) {
    lines.push('', locale === 'ko' ? '⭐ Top 후보' : '⭐ Top candidates', '');
    snapshot.topCandidates.slice(0, 3).forEach((candidate, index) => {
      lines.push(...renderCandidate(candidate, index, locale));
      lines.push('');
    });
  }
  lines.push(locale === 'ko' ? '💰 오늘 사용량' : '💰 Usage');
  lines.push(`• Jungle Scout: ${snapshot.jungleScoutUsed} / ${snapshot.jungleScoutBudget}`);
  if (snapshot.reservedUsed !== undefined && snapshot.reservedBudget !== undefined) {
    lines.push(`• Reserved: ${snapshot.reservedUsed} / ${snapshot.reservedBudget}`);
  }
  if (snapshot.aiAnalyses !== undefined) {
    lines.push(locale === 'ko' ? `• AI 분석: ${snapshot.aiAnalyses}` : `• AI analyses: ${snapshot.aiAnalyses}`);
  }
  if (snapshot.needsAttention > 0) {
    lines.push('', locale === 'ko' ? '⚠️ 확인 필요' : '⚠️ Needs attention');
    lines.push(countLine(locale, 'Needs Attention', 'Needs Attention', snapshot.needsAttention));
  }
  if (snapshot.nextRunLabel) {
    lines.push('');
    lines.push(
      locale === 'ko'
        ? `다음 자동 리서치: ${snapshot.nextRunLabel}`
        : `Next scheduled research: ${snapshot.nextRunLabel}`
    );
  }
  lines.push('', `Run: ${snapshot.runIdShort}`);
  return lines;
}

export function renderDailyDigest(data: DailyDigestData, locale: Locale): string {
  const parsedLocale = LocaleSchema.parse(locale);
  if (data.snapshot) {
    const lines = renderSnapshot(data.snapshot, parsedLocale);
    for (const event of data.events) {
      if (
        event.type === 'heartbeat' ||
        event.type === 'cache_hit' ||
        event.type === NotificationEventType.DAILY_SUMMARY
      ) {
        continue;
      }
      lines.push(event.summary);
    }
    return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n').trim();
  }
  const lines = [HEADING[parsedLocale]];
  for (const event of data.events) {
    if (event.type === 'heartbeat' || event.type === 'cache_hit') {
      continue;
    }
    lines.push(event.summary);
  }
  return lines.join('\n');
}
