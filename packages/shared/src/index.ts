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

export { ResearchSettingsSchema } from './settings';
export type { ResearchSettings, ResearchSettingsInput } from './settings';
export { formatLog } from './logger';
export type { StructuredLog } from './logger';
export { COPY, DEFAULT_LOCALE, getCopy } from './i18n';
export type { CopyKey } from './i18n';

export {
  AiModelDescriptorSchema,
  AiProviderConfigSchema,
  AiRequestSchema,
  AiRoleSchema,
  AiUsageSchema,
  AnalysisLeaseIdentitySchema,
  assertPersistableModelId,
  BillingTypeSchema,
  JobLeaseIdentitySchema,
  ModelIdSchema,
  NormalizeOpportunitiesJobPayloadSchema,
  ProbeGenerationSchema,
  ProviderAttemptEventTypeSchema,
  ProviderCapabilitySchema,
  ProviderConsumptionStatusSchema,
  ProviderKindSchema,
  ProviderRuntimeStateSchema,
  RouterModeSchema,
  SubscriptionAdapterSchema,
  SubscriptionFailureClassSchema,
  TestAiProviderConnectionJobPayloadSchema,
  UnsafeModelIdError
} from './ai';
export type {
  AiModelDescriptor,
  AiProviderConfig,
  AiRequest,
  AiResult,
  AiRole,
  AiUsage,
  AnalysisLeaseIdentity,
  BillingType,
  JobLeaseIdentity,
  NormalizeOpportunitiesJobPayload,
  ProbeGeneration,
  ProviderAttemptEventType,
  ProviderCapability,
  ProviderConsumptionStatus,
  ProviderKind,
  ProviderRuntimeState,
  RouterMode,
  SubscriptionAdapter,
  SubscriptionFailureClass,
  TestAiProviderConnectionJobPayload
} from './ai';

export {
  ApiCacheKeyInputSchema,
  ApiCallPurposeSchema,
  DeepValidationJobPayloadSchema,
  EnrichStrongPotentialJobPayloadSchema,
  JungleScoutEndpointSchema,
  MarketProbeJobPayloadSchema,
  MarketSnapshotSchema,
  makeApiCacheKey
} from './jungle-scout';
export type {
  ApiCacheKeyInput,
  ApiCallPurpose,
  DeepValidationJobPayload,
  EnrichStrongPotentialJobPayload,
  JungleScoutEndpoint,
  MarketProbeJobPayload,
  MarketSnapshot
} from './jungle-scout';

export {
  DailyResearchJobPayloadSchema,
  LogicalRunDateSchema,
  ResearchNowModeSchema,
  ScheduledMarketProbePayloadSchema
} from './automation';
export type {
  DailyResearchJobPayload,
  LogicalRunDate,
  ResearchNowMode,
  ScheduledMarketProbePayload
} from './automation';
export {
  AnalysisVerdictEvidenceSchema,
  DailyResearchCheckpointSchema,
  DailyResearchPlanItemSchema,
  DailyResearchSelectedCandidateIdsSchema
} from './automation';
export type { DailyResearchCheckpoint } from './automation';
