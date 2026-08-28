import { z } from 'zod';
import { LocaleSchema } from './domain';

const PercentageSchema = z.int().min(0).max(100);
const NonNegativeIntegerSchema = z.int().min(0);
const FreshnessHoursSchema = z.int().min(1).max(24 * 365);

export const ResearchSettingsSchema = z
  .object({
    locale: LocaleSchema.default('ko'),
    timezone: z.literal('America/Chicago').default('America/Chicago'),
    dailyApiBudget: NonNegativeIntegerSchema.default(20),
    manualApiReserve: NonNegativeIntegerSchema.default(5),
    manualReserveEnabled: z.boolean().default(true),
    newPercent: PercentageSchema.default(60),
    watchPercent: PercentageSchema.default(30),
    strongPercent: PercentageSchema.default(10),
    newFreshnessHours: FreshnessHoursSchema.default(24 * 7),
    watchFreshnessHours: FreshnessHoursSchema.default(24 * 7),
    strongFreshnessHours: FreshnessHoursSchema.default(24),
    notificationLocale: LocaleSchema.nullable().default(null),
    telegramEnabled: z.boolean().default(false)
  })
  .superRefine((settings, context) => {
    if (
      settings.newPercent + settings.watchPercent + settings.strongPercent !==
      100
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Exploration percentages must total 100.',
        path: ['newPercent']
      });
    }

    if (
      settings.manualReserveEnabled &&
      settings.manualApiReserve > settings.dailyApiBudget
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Manual API reserve cannot exceed the daily API budget.',
        path: ['manualApiReserve']
      });
    }
  });

export type ResearchSettings = z.output<typeof ResearchSettingsSchema>;
export type ResearchSettingsInput = z.input<typeof ResearchSettingsSchema>;
