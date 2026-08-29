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

export type DailyDigestData = {
  readonly events: readonly DigestEvent[];
};

const HEADING: Record<Locale, string> = {
  ko: '오늘의 리서치 요약',
  en: 'Today’s research summary'
};

export function renderDailyDigest(data: DailyDigestData, locale: Locale): string {
  const parsedLocale = LocaleSchema.parse(locale);
  const lines = [HEADING[parsedLocale]];
  for (const event of data.events) {
    if (event.type === 'heartbeat' || event.type === 'cache_hit') {
      continue;
    }
    lines.push(event.summary);
  }
  return lines.join('\n');
}
