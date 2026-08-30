import { constants } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_MAX = 256 * 1024;
const RESULT_MAX = 2 * 1024 * 1024;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const DIRECTORY = constants.O_DIRECTORY ?? 0;
const REQUEST_KEYS = Object.freeze([
  'adapter',
  'attemptId',
  'inputHash',
  'locale',
  'modelId',
  'profileId',
  'prompt',
  'role',
  'version'
]);
const CLIENTS = Object.freeze({
  codex: Object.freeze({
    executable: '/usr/local/libexec/amazon-research/codex-subscription-client',
    args: Object.freeze(['--fixed-profile', 'codex-subscription-v1']),
    profileId: 'codex-subscription-v1',
    modelId: 'gpt-5.6'
  }),
  grok: Object.freeze({
    executable: '/usr/local/libexec/amazon-research/grok-subscription-client',
    args: Object.freeze(['--fixed-profile', 'grok-subscription-v1']),
    profileId: 'grok-subscription-v1',
    modelId: null
  })
});

function modeBits(mode) {
  return mode & 0o7777;
}

function numericIdentity(value, name) {
  if (!/^(0|[1-9][0-9]*)$/u.test(value ?? '')) {
    throw new TypeError(`Invalid ${name}.`);
  }
  return Number(value);
}

function runtimeRoot() {
  const override = process.env.NODE_ENV === 'test'
    ? process.env.ARA_SUBSCRIPTION_RUNTIME_ROOT
    : undefined;
  const root = override ?? '/run/amazon-research/subscription';
  if (!isAbsolute(root)) throw new TypeError('Subscription runtime root must be absolute.');
  return root;
}

function expectedApprovedUid() {
  return process.env.NODE_ENV === 'test'
    ? numericIdentity(
      process.env.ARA_TEST_APPROVED_UID ?? String(process.getuid?.() ?? 0),
      'test approved uid'
    )
    : 0;
}

function fixedPaths(adapter, instance) {
  if (!(adapter in CLIENTS) || !UUID_PATTERN.test(instance)) {
    throw new TypeError('Invalid fixed adapter invocation identity.');
  }
  const adapterRoot = join(runtimeRoot(), adapter);
  return Object.freeze({
    invocation: join(adapterRoot, instance),
    approved: join(adapterRoot, '.approved', instance)
  });
}

function descriptorPath(directory, fileName) {
  return process.platform === 'linux'
    ? `/proc/self/fd/${directory.fd}/${fileName}`
    : join(directory.path, fileName);
}

function verifyIdentity(info, expected) {
  if (!info.isDirectory() && !info.isFile()) {
    throw new TypeError('Protocol object has an invalid type.');
  }
  if (process.platform !== 'win32') {
    if (expected.uid !== undefined && info.uid !== expected.uid) {
      throw new TypeError('Protocol object has an invalid owner.');
    }
    if (expected.gid !== undefined && info.gid !== expected.gid) {
      throw new TypeError('Protocol object has an invalid group.');
    }
    if (modeBits(info.mode) !== expected.mode) {
      throw new TypeError('Protocol object has an invalid mode.');
    }
  }
}

async function openPinnedDirectory(path, expected) {
  const handle = await open(path, constants.O_RDONLY | DIRECTORY | NO_FOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isDirectory()) throw new TypeError('Protocol directory is not a directory.');
    verifyIdentity(info, expected);
    return { path, fd: handle.fd, handle, info };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function readPinnedJson(directory, fileName, maximumBytes, expected) {
  const handle = await open(
    descriptorPath(directory, fileName),
    constants.O_RDONLY | NO_FOLLOW
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximumBytes) {
      throw new TypeError('Invalid bounded protocol object.');
    }
    verifyIdentity(info, expected);
    const payload = await handle.readFile();
    if (payload.byteLength > maximumBytes) {
      throw new TypeError('Invalid bounded protocol object.');
    }
    return { payload, value: JSON.parse(payload.toString('utf8')) };
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  try {
    await directory.handle.sync();
  } catch (error) {
    if (
      process.platform !== 'win32' ||
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'EPERM'
    ) {
      throw error;
    }
  }
}

function validateRequest(request, adapter, instance) {
  const profile = CLIENTS[adapter];
  const keys = request !== null && typeof request === 'object' && !Array.isArray(request)
    ? Object.keys(request).sort()
    : [];
  if (
    profile === undefined || profile.modelId === null ||
    keys.length !== REQUEST_KEYS.length ||
    !keys.every((key, index) => key === REQUEST_KEYS[index]) ||
    request.version !== 1 || request.adapter !== adapter || request.attemptId !== instance ||
    request.profileId !== profile.profileId || request.modelId !== profile.modelId ||
    request.role !== 'niche_normalization' ||
    typeof request.locale !== 'string' || request.locale.length < 1 || request.locale.length > 20 ||
    typeof request.prompt !== 'string' || request.prompt.length > 200_000 ||
    typeof request.inputHash !== 'string' || !/^[0-9a-f]{64}$/u.test(request.inputHash)
  ) {
    throw new TypeError('Request envelope failed fixed validation.');
  }
}

async function writePinnedFile(directory, temporaryName, finalName, payload, mode) {
  const temporary = descriptorPath(directory, temporaryName);
  const final = descriptorPath(directory, finalName);
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
    mode
  );
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, final);
  await syncDirectory(directory);
}

async function approveRequest(adapter, instance, approvedGid) {
  const paths = fixedPaths(adapter, instance);
  const invocation = await openPinnedDirectory(paths.invocation, { mode: 0o2770 });
  let approved;
  try {
    const source = await readPinnedJson(invocation, 'request.json', REQUEST_MAX, {
      uid: invocation.info.uid,
      gid: invocation.info.gid,
      mode: 0o640
    });
    validateRequest(source.value, adapter, instance);
    approved = await openPinnedDirectory(paths.approved, {
      uid: expectedApprovedUid(),
      gid: approvedGid,
      mode: 0o2550
    });
    await writePinnedFile(approved, 'request.tmp', 'request.json', source.payload, 0o440);
    const sealed = await readPinnedJson(approved, 'request.json', REQUEST_MAX, {
      uid: expectedApprovedUid(),
      gid: approvedGid,
      mode: 0o440
    });
    validateRequest(sealed.value, adapter, instance);
    await unlink(descriptorPath(invocation, 'request.json'));
    await syncDirectory(invocation);
  } finally {
    await approved?.handle.close().catch(() => undefined);
    await invocation.handle.close().catch(() => undefined);
  }
}

async function readApprovedRequest(adapter, instance, approvedGid) {
  const directory = await openPinnedDirectory(fixedPaths(adapter, instance).approved, {
    uid: expectedApprovedUid(),
    gid: approvedGid,
    mode: 0o2550
  });
  try {
    const request = await readPinnedJson(directory, 'request.json', REQUEST_MAX, {
      uid: expectedApprovedUid(),
      gid: approvedGid,
      mode: 0o440
    });
    validateRequest(request.value, adapter, instance);
    return request.value;
  } finally {
    await directory.handle.close();
  }
}

async function atomicResult(directory, result) {
  const payload = Buffer.from(JSON.stringify(result), 'utf8');
  if (payload.byteLength > RESULT_MAX) {
    throw new RangeError('Result envelope exceeds fixed limit.');
  }
  await writePinnedFile(directory, 'result.tmp', 'result.json', payload, 0o640);
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

async function main(adapter, instance) {
  const approvedGid = process.env.NODE_ENV === 'test'
    ? numericIdentity(process.env.ARA_TEST_APPROVED_GID ?? String(process.getgid?.() ?? 0), 'test approved gid')
    : process.getgid();
  if (approvedGid === undefined) throw new TypeError('Adapter group identity is unavailable.');
  const request = await readApprovedRequest(adapter, instance, approvedGid);
  const output = await openPinnedDirectory(fixedPaths(adapter, instance).invocation, { mode: 0o2770 });
  try {
    await notify('READY=1');
    const execution = await executeClient(adapter, request);
    await atomicResult(output, {
      version: 1,
      adapter,
      attemptId: instance,
      outcome: execution.exit.code === 0 ? 'success' : 'failure',
      rawOutput: execution.stdout,
      clientExit: execution.exit
    });
  } finally {
    await output.handle.close();
  }
  await notify('STATUS=result-published');
  const stopped = Promise.withResolvers();
  process.once('SIGTERM', stopped.resolve);
  process.once('SIGINT', stopped.resolve);
  await stopped.promise;
}

async function cli() {
  const [mode, adapter, instance, identity] = process.argv.slice(2);
  if (mode === '--approve-request') {
    await approveRequest(adapter, instance, numericIdentity(identity, 'approved group identity'));
    return;
  }
  if (mode === '--validate-approved') {
    const approvedGid = process.env.NODE_ENV === 'test'
      ? numericIdentity(process.env.ARA_TEST_APPROVED_GID ?? String(process.getgid?.() ?? 0), 'test approved gid')
      : process.getgid();
    if (approvedGid === undefined) throw new TypeError('Adapter group identity is unavailable.');
    await readApprovedRequest(adapter, instance, approvedGid);
    return;
  }
  await main(mode, adapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await cli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Subscription supervisor failed.'}\n`);
    process.exitCode = 1;
  }
}
