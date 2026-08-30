export type SubscriptionIpcErrorKind =
  | 'path'
  | 'type'
  | 'ownership'
  | 'mode'
  | 'size'
  | 'schema'
  | 'io';

export class SubscriptionIpcError extends Error {
  readonly kind: SubscriptionIpcErrorKind;

  constructor(message: string, kind: SubscriptionIpcErrorKind, cause?: unknown) {
    super(message, { cause });
    this.name = 'SubscriptionIpcError';
    this.kind = kind;
  }
}

export type SubscriptionSandboxPhase = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
export type SubscriptionSandboxErrorKind =
  | 'cancelled'
  | 'timeout'
  | 'start'
  | 'state'
  | 'ipc'
  | 'cleanup';

export class SubscriptionSandboxError extends Error {
  readonly kind: SubscriptionSandboxErrorKind;
  readonly phase: SubscriptionSandboxPhase;

  constructor(
    message: string,
    kind: SubscriptionSandboxErrorKind,
    phase: SubscriptionSandboxPhase,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'SubscriptionSandboxError';
    this.kind = kind;
    this.phase = phase;
  }
}
