import type { AiModelDescriptor, BillingType } from '@ara/shared';
import {
  runWithSchema,
  type ProviderHealth,
  type RawAiProvider,
  type StructuredAiRequest,
  type AiProviderResult
} from './structured';

export interface AiProvider {
  readonly id: string;
  readonly billingType: BillingType;
  health(): Promise<ProviderHealth>;
  listModels(): Promise<readonly AiModelDescriptor[]>;
  runStructured<T>(request: StructuredAiRequest<T>): Promise<AiProviderResult<T>>;
}

export function wrapRawProvider(provider: RawAiProvider): AiProvider {
  return {
    id: provider.id,
    billingType: provider.billingType,
    health: () => provider.health(),
    listModels: () => provider.listModels(),
    runStructured: <T>(request: StructuredAiRequest<T>) =>
      runWithSchema(provider, request.schema, request)
  };
}

export type {
  AiProviderResult,
  ProviderHealth,
  RawAiProvider,
  RawAiProviderResult,
  RawStructuredAiRequest,
  StructuredAiRequest
} from './structured';
export { InvalidStructuredOutputError, runWithSchema } from './structured';
