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

export { routeAiRequest } from './router';
export type {
  ProviderCatalog,
  ProviderCatalogEntry,
  RouteDecision,
  RouteDeferral,
  RouteSelection
} from './router';
