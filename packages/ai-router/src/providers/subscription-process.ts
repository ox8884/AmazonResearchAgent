import { z } from 'zod';

export { SubscriptionIpcError } from './subscription-errors';
export {
  createExclusiveRegularFile,
  openVerifiedRegularFile
} from './subscription-ipc-files';
export {
  readVerifiedIpcJson,
  writeAtomicIpcJson
} from './subscription-ipc-json';
export {
  verifyInvocationDirectory
} from './subscription-invocation-directory';
export type {
  VerifiedInvocationDirectory
} from './subscription-invocation-directory';

export const IPC_LIMITS = {
  request: 256 * 1024,
  result: 2 * 1024 * 1024,
  diagnostic: 64 * 1024,
  frame: 256 * 1024,
  aggregateOutput: 2 * 1024 * 1024
} as const;

export const SubscriptionRequestEnvelopeSchema = z.object({
  version: z.literal(1),
  adapter: z.enum(['codex', 'grok']),
  profileId: z.string().trim().min(1).max(200),
  attemptId: z.uuid(),
  modelId: z.string().trim().min(1).max(200),
  role: z.literal('niche_normalization'),
  locale: z.string().trim().min(1).max(20),
  prompt: z.string().max(200_000),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/u)
}).strict();
export type SubscriptionRequestEnvelope = z.infer<
  typeof SubscriptionRequestEnvelopeSchema
>;

export const SubscriptionResultEnvelopeSchema = z.object({
  version: z.literal(1),
  adapter: z.enum(['codex', 'grok']),
  attemptId: z.uuid(),
  outcome: z.enum(['success', 'failure']),
  rawOutput: z.string().max(IPC_LIMITS.aggregateOutput),
  clientExit: z.object({
    code: z.number().int().nullable(),
    signal: z.string().nullable()
  }).strict()
}).strict();
export type SubscriptionResultEnvelope = z.infer<
  typeof SubscriptionResultEnvelopeSchema
>;

export interface SubscriptionProcessTransport<Profile, Invocation, Result> {
  readonly isolation: 'systemd-subscription-sandbox-v1';
  run(profile: Profile, invocation: Invocation, signal: AbortSignal): Promise<Result>;
}

export const SubscriptionIpcProtocol = {
  roots: {
    codex: '/run/amazon-research/subscription/codex',
    grok: '/run/amazon-research/subscription/grok'
  },
  files: {
    requestTemporary: 'request.tmp',
    requestFinal: 'request.json',
    resultTemporary: 'result.tmp',
    resultFinal: 'result.json',
    diagnosticTemporary: 'diagnostic.tmp',
    diagnosticFinal: 'diagnostic.json'
  },
  limits: IPC_LIMITS
} as const;
