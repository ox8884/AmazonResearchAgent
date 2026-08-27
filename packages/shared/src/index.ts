export { APP_NAME } from './version';
export {
  CandidateStateSchema,
  ImportFileReferenceSchema,
  ImportOpportunityCsvJobPayloadSchema,
  ImportRunStatusSchema,
  LocaleSchema,
  OpportunityCsvRowSchema,
  PreliminaryCandidateSchema,
  RuleCodeSchema,
  RuleReasonSchema,
  SearchVolumeSchema
} from './domain';
export type {
  CandidateState,
  ImportFileReference,
  ImportOpportunityCsvJobPayload,
  ImportRunStatus,
  Locale,
  OpportunityCsvRow,
  OpportunityCsvRowInput,
  PreliminaryCandidate,
  RuleCode,
  RuleReason,
  SearchVolume
} from './domain';
export { COPY, DEFAULT_LOCALE, getCopy } from './i18n';
export type { CopyKey } from './i18n';
