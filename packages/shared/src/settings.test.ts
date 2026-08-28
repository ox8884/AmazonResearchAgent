import { describe, expect, it } from 'vitest';
import { ResearchSettingsSchema } from './settings';

describe('research settings schema', () => {
  // Break: an impossible daily allocation is accepted and can overcommit automation work.
  it('requires exploration percentages to total 100', () => {
    expect(() =>
      ResearchSettingsSchema.parse({
        newPercent: 60,
        watchPercent: 30,
        strongPercent: 20
      })
    ).toThrow();
  });

  // Break: the dashboard starts in English or uses a non-Chicago daily schedule by default.
  it('defaults to Korean, America/Chicago, and the approved 60/30/10 allocation', () => {
    expect(ResearchSettingsSchema.parse({})).toMatchObject({
      locale: 'ko',
      timezone: 'America/Chicago',
      newPercent: 60,
      watchPercent: 30,
      strongPercent: 10,
      manualReserveEnabled: true,
      telegramEnabled: false
    });
  });

  // Break: a notification locale becomes stale when it is meant to follow the app locale.
  it('keeps notification locale unset unless explicitly overridden', () => {
    expect(ResearchSettingsSchema.parse({ locale: 'en' }).notificationLocale).toBeNull();
    expect(
      ResearchSettingsSchema.parse({
        locale: 'en',
        notificationLocale: 'ko'
      }).notificationLocale
    ).toBe('ko');
  });
});
