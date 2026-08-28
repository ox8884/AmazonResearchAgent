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
export { COPY, DEFAULT_LOCALE, getCopy } from './i18n';
export type { CopyKey } from './i18n';

export {
  AiModelDescriptorSchema,
  AiProviderConfigSchema,
  AiRequestSchema,
  AiRoleSchema,
  AiUsageSchema,
  assertPersistableModelId,
  BillingTypeSchema,
  ModelIdSchema,
  NormalizeOpportunitiesJobPayloadSchema,
  ProviderCapabilitySchema,
  ProviderKindSchema,
  RouterModeSchema,
  TestAiProviderConnectionJobPayloadSchema,
  UnsafeModelIdError
} from './ai';
export type {
  NormalizeOpportunitiesJobPayload,
  AiModelDescriptor,
  AiProviderConfig,
  AiRequest,
  AiResult,
  AiRole,
  AiUsage,
  BillingType,
  ProviderCapability,
  ProviderKind,
  RouterMode,
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
