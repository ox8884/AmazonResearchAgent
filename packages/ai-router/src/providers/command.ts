import { spawn } from 'node:child_process';
import {
  AiUsageSchema,
  type AiModelDescriptor,
  type BillingType,
  type ProviderCapability
} from '@ara/shared';
import {
  runWithSchema,
  type AiProviderResult,
  type ProviderHealth,
  type RawAiProvider,
  type RawAiProviderResult,
  type RawStructuredAiRequest,
  type StructuredAiRequest
} from '../provider';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CAPABILITIES = ['structured_json', 'health'] as const satisfies readonly ProviderCapability[];

export type CommandPromptMode = 'stdin' | 'final_arg';
export type CommandOutputMode = 'json' | 'text_to_json';
export type CommandErrorKind = 'timeout' | 'output_limit' | 'execution';

export interface CommandProviderConfig {
  readonly id: string;
  readonly billingType: BillingType;
  readonly executable: string;
  readonly fixedArgs: readonly string[];
  readonly modelId: string;
  readonly promptMode: CommandPromptMode;
  readonly outputMode: CommandOutputMode;
  readonly environmentAllowlist: readonly string[];
  readonly healthArgs?: readonly string[];
  readonly timeoutMs?: number;
}

export class CommandProviderError extends Error {
  readonly kind: CommandErrorKind;
  readonly retryable: boolean;

  constructor(
    message: string,
    kind: CommandErrorKind,
    retryable: boolean,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'CommandProviderError';
    this.kind = kind;
    this.retryable = retryable;
  }
}

interface CommandExecutionOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly prompt: string;
  readonly promptMode: CommandPromptMode;
  readonly environmentAllowlist: readonly string[];
  readonly timeoutMs: number;
}

interface CommandExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
}

function allowedEnvironment(
  environmentAllowlist: readonly string[]
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
  for (const name of environmentAllowlist) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return environment;
}

function executeCommand(
  options: CommandExecutionOptions
): Promise<CommandExecutionResult> {
  const { promise, resolve, reject } =
    Promise.withResolvers<CommandExecutionResult>();
  const child = spawn(options.executable, [...options.args], {
    shell: false,
    env: allowedEnvironment(options.environmentAllowlist),
    stdio: 'pipe',
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  let settled = false;

  function cleanup(): void {
    clearTimeout(timer);
  }
  function fail(error: Error): void {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    reject(error);
  }
  const append = (current: string, chunk: string): string => {
    const next = current + chunk;
    if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT_BYTES) {
      child.kill();
      fail(
        new CommandProviderError(
          'Command output exceeded the limit.',
          'output_limit',
          false
        )
      );
    }
    return next;
  };

  const timer = setTimeout(() => {
    child.kill();
    fail(new CommandProviderError('Command provider timed out.', 'timeout', true));
  }, options.timeoutMs);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout = append(stdout, chunk);
  });
  child.stderr.on('data', (chunk: string) => {
    stderr = append(stderr, chunk);
  });
  child.once('error', (error) => {
    fail(
      new CommandProviderError(
        'Command provider failed to start.',
        'execution',
        true,
        error
      )
    );
  });
  child.once('close', (code) => {
    if (settled) {
      return;
    }
    cleanup();
    if (code !== 0) {
      fail(
        new CommandProviderError(
          'Command provider exited unsuccessfully.',
          'execution',
          true
        )
      );
      return;
    }
    settled = true;
    resolve({ stdout, stderr });
  });

  if (options.promptMode === 'stdin') {
    child.stdin.end(options.prompt);
  } else {
    child.stdin.end();
  }
  return promise;
}

function extractJson(output: string, mode: CommandOutputMode): string {
  const trimmed = output.trim();
  if (mode === 'json') {
    return trimmed;
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < start) {
    return trimmed;
  }
  return trimmed.slice(start, end + 1);
}

function modelDescriptor(config: CommandProviderConfig): AiModelDescriptor {
  return {
    providerId: config.id,
    id: config.modelId,
    displayName: config.modelId,
    capabilities: [...DEFAULT_CAPABILITIES],
    billingType: config.billingType,
    qualityRank: 100
  };
}

export class CommandProvider implements RawAiProvider {
  readonly id: string;
  readonly billingType: BillingType;
  private readonly config: CommandProviderConfig;

  constructor(config: CommandProviderConfig) {
    if (config.executable.trim().length === 0 || config.modelId.trim().length === 0) {
      throw new CommandProviderError('Command provider configuration is incomplete.', 'execution', false);
    }
    this.config = { ...config, executable: config.executable.trim() };
    this.id = config.id;
    this.billingType = config.billingType;
  }

  async health(): Promise<ProviderHealth> {
    try {
      await executeCommand({
        executable: this.config.executable,
        args: [...this.config.fixedArgs, ...(this.config.healthArgs ?? ['--version'])],
        prompt: '',
        promptMode: 'stdin',
        environmentAllowlist: this.config.environmentAllowlist,
        timeoutMs: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
      });
      return {
        available: true,
        checkedAt: new Date().toISOString(),
        reason: null,
        retryAfterSeconds: null
      };
    } catch (error) {
      if (error instanceof CommandProviderError) {
        return {
          available: false,
          checkedAt: new Date().toISOString(),
          reason: error.message,
          retryAfterSeconds: error.retryable ? 60 : null
        };
      }
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        reason: 'Command provider is unavailable.',
        retryAfterSeconds: null
      };
    }
  }

  async listModels(): Promise<readonly AiModelDescriptor[]> {
    return [modelDescriptor(this.config)];
  }

  async runStructured<T>(
    request: StructuredAiRequest<T>
  ): Promise<AiProviderResult<T>> {
    return runWithSchema(this, request.schema, request);
  }

  async runRaw(request: RawStructuredAiRequest): Promise<RawAiProviderResult> {
    const args = [...this.config.fixedArgs];
    if (this.config.promptMode === 'final_arg') {
      args.push(request.prompt);
    }
    const startedAt = new Date().toISOString();
    const result = await executeCommand({
      executable: this.config.executable,
      args,
      prompt: request.prompt,
      promptMode: this.config.promptMode,
      environmentAllowlist: this.config.environmentAllowlist,
      timeoutMs: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    });
    return {
      rawOutput: extractJson(result.stdout, this.config.outputMode),
      providerId: this.id,
      modelId: request.modelId,
      role: request.role,
      inputHash: request.inputHash,
      usage: AiUsageSchema.parse({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        requestCount: 1
      }),
      costClass: this.billingType,
      startedAt,
      completedAt: new Date().toISOString()
    };
  }
}
