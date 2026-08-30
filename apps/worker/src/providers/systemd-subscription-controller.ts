import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { SubscriptionSandboxError } from '@ara/ai-router';

const execFileAsync = promisify(execFile);
const UNIT_PATTERN = /^amazon-research-(codex|grok)@[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.service$/u;
const SYSTEMCTL_PROPERTIES = [
  'ActiveState',
  'SubState',
  'StatusText',
  'ExecMainCode',
  'ExecMainStatus',
  'Result'
] as const;

export type SubscriptionSystemctlAction =
  | 'start'
  | 'show'
  | 'stop'
  | 'kill'
  | 'control-group';

export interface SubscriptionUnitState {
  readonly activeState: string;
  readonly subState: string;
  readonly statusText: string;
  readonly execMainCode: number;
  readonly execMainStatus: number;
  readonly result: string;
}

export interface SubscriptionSandboxController {
  startNoBlock(unitName: string): Promise<void>;
  show(unitName: string): Promise<SubscriptionUnitState>;
  stop(unitName: string): Promise<void>;
  killAll(unitName: string): Promise<void>;
  waitTerminal(unitName: string, timeoutMs: number): Promise<void>;
  isCgroupEmpty(unitName: string): Promise<boolean>;
}

export function subscriptionSystemctlArguments(
  action: SubscriptionSystemctlAction,
  unitName: string
): readonly string[] {
  if (!UNIT_PATTERN.test(unitName)) {
    throw new SubscriptionSandboxError(
      'Systemd unit identity is not allowed.',
      'start',
      'S0'
    );
  }
  switch (action) {
    case 'start':
      return ['start', '--no-block', unitName];
    case 'stop':
      return ['stop', '--no-block', unitName];
    case 'kill':
      return ['kill', '--kill-who=all', unitName];
    case 'control-group':
      return ['show', unitName, '--property', 'ControlGroup', '--value'];
    case 'show':
      return [
        'show',
        unitName,
        ...SYSTEMCTL_PROPERTIES.flatMap((property) => ['--property', property])
      ];
  }
}

export function parseSystemctlProperties(output: string): SubscriptionUnitState {
  const properties = new Map<string, string>();
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      properties.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }
  const integer = (name: string): number => {
    const parsed = Number.parseInt(properties.get(name) ?? '', 10);
    return Number.isInteger(parsed) ? parsed : 0;
  };
  return {
    activeState: properties.get('ActiveState') ?? 'unknown',
    subState: properties.get('SubState') ?? 'unknown',
    statusText: properties.get('StatusText') ?? '',
    execMainCode: integer('ExecMainCode'),
    execMainStatus: integer('ExecMainStatus'),
    result: properties.get('Result') ?? 'unknown'
  };
}

function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

async function runSystemctl(
  args: readonly string[],
  maxBuffer?: number
): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/systemctl', [...args], {
    windowsHide: true,
    ...(maxBuffer === undefined ? {} : { maxBuffer })
  });
  return stdout;
}

export class SystemctlSubscriptionSandboxController
  implements SubscriptionSandboxController {
  async startNoBlock(unitName: string): Promise<void> {
    await runSystemctl(subscriptionSystemctlArguments('start', unitName));
  }

  async show(unitName: string): Promise<SubscriptionUnitState> {
    const stdout = await runSystemctl(
      subscriptionSystemctlArguments('show', unitName),
      64 * 1024
    );
    return parseSystemctlProperties(stdout);
  }

  async stop(unitName: string): Promise<void> {
    await runSystemctl(subscriptionSystemctlArguments('stop', unitName));
  }

  async killAll(unitName: string): Promise<void> {
    await runSystemctl(subscriptionSystemctlArguments('kill', unitName));
  }

  async waitTerminal(unitName: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.show(unitName);
      if (state.activeState === 'inactive' || state.activeState === 'failed') {
        return;
      }
      await delay(50);
    }
    throw new SubscriptionSandboxError(
      'Systemd unit did not reach terminal state.',
      'cleanup',
      'S5'
    );
  }

  async isCgroupEmpty(unitName: string): Promise<boolean> {
    const controlGroup = (
      await runSystemctl(
        subscriptionSystemctlArguments('control-group', unitName),
        4096
      )
    ).trim();
    if (controlGroup.length === 0) return true;
    try {
      const processes = await readFile(
        `/sys/fs/cgroup${controlGroup}/cgroup.procs`,
        'utf8'
      );
      return processes.trim().length === 0;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return true;
      }
      throw error;
    }
  }
}
