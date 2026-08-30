import { constants } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { open, rename, stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_MAX = 256 * 1024;
const RESULT_MAX = 2 * 1024 * 1024;
const CLIENTS = Object.freeze({
  codex: Object.freeze({
    executable: '/usr/local/libexec/amazon-research/codex-subscription-client',
    args: Object.freeze(['--fixed-profile', 'codex-subscription-v1'])
  }),
  grok: Object.freeze({
    executable: '/usr/local/libexec/amazon-research/grok-subscription-client',
    args: Object.freeze(['--fixed-profile', 'grok-subscription-v1'])
  })
});

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function invocation(adapter, instance) {
  if (!(adapter in CLIENTS) || !UUID_PATTERN.test(instance)) {
    throw new TypeError('Invalid fixed adapter invocation identity.');
  }
  return `/run/amazon-research/subscription/${adapter}/${instance}`;
}

async function readBoundedJson(path, maximumBytes) {
  const before = await stat(path, { bigint: false });
  if (!before.isFile() || before.size > maximumBytes) {
    throw new TypeError('Invalid bounded protocol object.');
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.size > maximumBytes) {
      throw new TypeError('Invalid bounded protocol object.');
    }
    return JSON.parse((await handle.readFile()).toString('utf8'));
  } finally {
    await handle.close();
  }
}

function validateRequest(request, adapter, instance) {
  if (
    request === null || typeof request !== 'object' || Array.isArray(request) ||
    request.version !== 1 || request.adapter !== adapter || request.attemptId !== instance ||
    request.role !== 'niche_normalization' || typeof request.profileId !== 'string' ||
    typeof request.modelId !== 'string' || typeof request.locale !== 'string' ||
    typeof request.prompt !== 'string' || typeof request.inputHash !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(request.inputHash) || request.prompt.length > 200000
  ) {
    throw new TypeError('Request envelope failed fixed validation.');
  }
}

async function atomicResult(directory, result) {
  const payload = Buffer.from(JSON.stringify(result), 'utf8');
  if (payload.byteLength > RESULT_MAX) {
    throw new RangeError('Result envelope exceeds fixed limit.');
  }
  const temporary = `${directory}/result.tmp`;
  const final = `${directory}/result.json`;
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o640
  );
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, final);
  const parent = await open(directory, constants.O_RDONLY);
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

async function notify(value) {
  await execFileAsync('/usr/bin/systemd-notify', [value], {
    env: Object.freeze({ NOTIFY_SOCKET: process.env.NOTIFY_SOCKET ?? '' }),
    windowsHide: true
  });
}

async function executeClient(adapter, request) {
  const profile = CLIENTS[adapter];
  const child = spawn(profile.executable, [...profile.args], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: Object.freeze({
      HOME: process.env.HOME ?? '',
      TMPDIR: process.env.TMPDIR ?? '',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8'
    }),
    detached: false
  });
  const stdout = [];
  const stderr = [];
  let total = 0;
  const completion = Promise.withResolvers();
  const append = (target, chunk) => {
    total += chunk.length;
    if (total > RESULT_MAX) {
      child.kill('SIGKILL');
      completion.reject(new RangeError('Provider output exceeds fixed aggregate limit.'));
      return;
    }
    target.push(chunk);
  };
  child.stdout.on('data', (chunk) => append(stdout, chunk));
  child.stderr.on('data', (chunk) => append(stderr, chunk));
  child.once('error', completion.reject);
  child.once('close', (code, signal) => completion.resolve({ code, signal }));
  child.stdin.end(JSON.stringify(request));
  const exit = await completion.promise;
  return {
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderrBytes: Buffer.concat(stderr).byteLength,
    exit
  };
}

async function validateOnly(adapter, instance) {
  const directory = invocation(adapter, instance);
  const request = await readBoundedJson(`${directory}/request.json`, REQUEST_MAX);
  validateRequest(request, adapter, instance);
}

async function main(adapter, instance) {
  const directory = invocation(adapter, instance);
  const request = await readBoundedJson(`${directory}/request.json`, REQUEST_MAX);
  validateRequest(request, adapter, instance);
  await notify('READY=1');
  const execution = await executeClient(adapter, request);
  await atomicResult(directory, {
    version: 1,
    adapter,
    attemptId: instance,
    outcome: execution.exit.code === 0 ? 'success' : 'failure',
    rawOutput: execution.stdout,
    clientExit: execution.exit
  });
  await notify('STATUS=result-published');
  const stopped = Promise.withResolvers();
  process.once('SIGTERM', stopped.resolve);
  process.once('SIGINT', stopped.resolve);
  await stopped.promise;
}

const [mode, adapter, instance] = process.argv.slice(2);
try {
  if (mode === '--validate-request') {
    await validateOnly(adapter, instance);
  } else {
    await main(mode, adapter);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : 'Subscription supervisor failed.');
}
