import { z } from 'zod';
import { LocaleSchema } from './domain';
import { ApiCallPurposeSchema } from './jungle-scout';

export const LogicalRunDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO calendar date (YYYY-MM-DD).')
  .refine((value) => {
    const [yearText, monthText, dayText] = value.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Expected a valid ISO calendar date (YYYY-MM-DD).');
export type LogicalRunDate = z.infer<typeof LogicalRunDateSchema>;

export const DailyResearchJobPayloadSchema = z.object({
  researchRunId: z.uuid(),
  logicalRunDate: LogicalRunDateSchema,
  locale: LocaleSchema
});
export type DailyResearchJobPayload = z.infer<
  typeof DailyResearchJobPayloadSchema
>;

export const ScheduledMarketProbePayloadSchema = z.object({
  candidateId: z.uuid(),
  locale: LocaleSchema,
  purpose: ApiCallPurposeSchema
});
export const AnalysisVerdictEvidenceSchema = z.object({
  verdict: z.literal('strong_potential')
});

export const DailyResearchPlanItemSchema = z.object({
  id: z.uuid(),
  bucket: z.enum(['new', 'watch', 'strong'])
});

export const DailyResearchCheckpointSchema = z.object({
  phase: z.enum(['fanout', 'fanout_complete']),
  selectedItems: z.array(DailyResearchPlanItemSchema),
  enqueuedCandidateIds: z.array(z.uuid())
});
export const DailyResearchSelectedCandidateIdsSchema = z.array(z.uuid());
export type DailyResearchCheckpoint = z.infer<
  typeof DailyResearchCheckpointSchema
>;
export type ScheduledMarketProbePayload = z.infer<
  typeof ScheduledMarketProbePayloadSchema
>;
