export {
  InvalidStructuredOutputError,
  runWithSchema,
  wrapRawProvider
} from './provider';
export type {
  AiProvider,
  AiProviderResult,
  ProviderHealth,
  RawAiProvider,
  RawAiProviderResult,
  RawStructuredAiRequest,
  StructuredAiRequest
} from './provider';

export {
  MODEL_LIST_MAX_BYTES,
  COMPLETION_MAX_BYTES,
  TEST_CONNECTION_REQUIRED,
  OpenAiHttpError,
  OpenAiHttpProvider
} from './providers/openai-http';
export {
  CommandProvider,
  CommandProviderError
} from './providers/command';
export type {
  CommandErrorKind,
  CommandOutputMode,
  CommandPromptMode,
  CommandProviderConfig
} from './providers/command';
export {
  IPC_LIMITS,
  SubscriptionIpcError,
  SubscriptionRequestEnvelopeSchema,
  SubscriptionResultEnvelopeSchema,
  createExclusiveRegularFile,
  openVerifiedRegularFile,
  readVerifiedIpcJson,
  verifyInvocationDirectory,
  writeAtomicIpcJson
} from './providers/subscription-process';
export type {
  SubscriptionProcessTransport,
  SubscriptionRequestEnvelope,
  SubscriptionResultEnvelope,
  VerifiedInvocationDirectory
} from './providers/subscription-process';
export {
  SubscriptionSandboxError
} from './providers/subscription-errors';
export type {
  SubscriptionIpcErrorKind,
  SubscriptionSandboxErrorKind,
  SubscriptionSandboxPhase
} from './providers/subscription-errors';

export { routeAiRequest } from './router';
export type {
  ProviderCatalog,
  ProviderCatalogEntry,
  RouteDecision,
  RouteDeferral,
  RouteSelection
} from './router';
