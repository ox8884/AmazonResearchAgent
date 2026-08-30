import { chmod, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  IPC_LIMITS,
  SubscriptionIpcError,
  readVerifiedIpcJson,
  verifyInvocationDirectory,
  writeAtomicIpcJson
} from './subscription-process';

const roots: string[] = [];

async function fixtureDirectory(): Promise<{ readonly root: string; readonly invocation: string; readonly id: string }> {
  const root = join(tmpdir(), `ara-subscription-${randomUUID()}`);
  const id = randomUUID();
  const invocation = join(root, id);
  await mkdir(invocation, { recursive: true, mode: 0o2770 });
  await chmod(invocation, 0o2770);
  roots.push(root);
  return { root, invocation, id };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const EnvelopeSchema = z.object({ version: z.literal(1), value: z.string() }).strict();

describe('subscription IPC protocol', () => {
  // Break: a caller can publish into a path that root/systemd has not created.
  it('worker cannot publish before invocation directory exists', async () => {
    const root = join(tmpdir(), `ara-missing-${randomUUID()}`);
    await expect(writeAtomicIpcJson({
      directoryPath: join(root, randomUUID()),
      temporaryName: 'request.tmp',
      finalName: 'request.json',
      value: { version: 1, value: 'x' },
      schema: EnvelopeSchema,
      maximumBytes: IPC_LIMITS.request,
      mode: 0o640
    })).rejects.toBeInstanceOf(SubscriptionIpcError);
  });

  // Break: a sibling or escaped directory is accepted as the authoritative attempt path.
  it('worker verifies directory before request write', async () => {
    const fixture = await fixtureDirectory();
    const directory = await verifyInvocationDirectory({
      directoryPath: fixture.invocation,
      expectedRoot: fixture.root,
      instanceId: fixture.id,
      expectedMode: 0o2770
    });
    expect(directory).toMatchObject({ path: fixture.invocation });
    await directory.close();
    await expect(verifyInvocationDirectory({
      directoryPath: fixture.root,
      expectedRoot: fixture.root,
      instanceId: fixture.id,
      expectedMode: 0o2770
    })).rejects.toBeInstanceOf(SubscriptionIpcError);
  });

  // Break: a directory owned by another UID or IPC group is accepted.
  it('rejects wrong invocation ownership', async () => {
    const fixture = await fixtureDirectory();
    const info = await lstat(fixture.invocation);
    await expect(verifyInvocationDirectory({
      directoryPath: fixture.invocation,
      expectedRoot: fixture.root,
      instanceId: fixture.id,
      expectedUid: info.uid + 1,
      expectedMode: 0o2770
    })).rejects.toMatchObject({ kind: 'ownership' });
    await expect(verifyInvocationDirectory({
      directoryPath: fixture.invocation,
      expectedRoot: fixture.root,
      instanceId: fixture.id,
      expectedGid: info.gid + 1,
      expectedMode: 0o2770
    })).rejects.toMatchObject({ kind: 'ownership' });
  });

  // Break: request publication exposes a partial final file or overwrites an existing request.
  it('worker publishes request only by exclusive tmp fsync rename', async () => {
    const fixture = await fixtureDirectory();
    const input = { version: 1 as const, value: 'bounded' };
    await writeAtomicIpcJson({
      directoryPath: fixture.invocation,
      temporaryName: 'request.tmp',
      finalName: 'request.json',
      value: input,
      schema: EnvelopeSchema,
      maximumBytes: IPC_LIMITS.request,
      mode: 0o640
    });
    expect(JSON.parse(await readFile(join(fixture.invocation, 'request.json'), 'utf8'))).toEqual(input);
    await expect(lstat(join(fixture.invocation, 'request.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(writeAtomicIpcJson({
      directoryPath: fixture.invocation,
      temporaryName: 'request.tmp',
      finalName: 'request.json',
      value: input,
      schema: EnvelopeSchema,
      maximumBytes: IPC_LIMITS.request,
      mode: 0o640
    })).rejects.toBeInstanceOf(SubscriptionIpcError);
  });

  // Break: a symbolic link can substitute for a fixed IPC object.
  it('rejects symlink and non-regular IPC objects', async () => {
    const fixture = await fixtureDirectory();
    await writeFile(join(fixture.invocation, 'target'), JSON.stringify({ version: 1, value: 'x' }));
    await symlink(join(fixture.invocation, 'target'), join(fixture.invocation, 'result.json'));
    await expect(readVerifiedIpcJson({
      directoryPath: fixture.invocation,
      fileName: 'result.json',
      schema: EnvelopeSchema,
      maximumBytes: IPC_LIMITS.result
    })).rejects.toBeInstanceOf(SubscriptionIpcError);
  });

  // Break: malformed or oversized final objects cross the protocol boundary.
  it('rejects malformed and oversized frames', async () => {
    const fixture = await fixtureDirectory();
    await writeFile(join(fixture.invocation, 'result.json'), '{');
    await expect(readVerifiedIpcJson({
      directoryPath: fixture.invocation,
      fileName: 'result.json',
      schema: EnvelopeSchema,
      maximumBytes: IPC_LIMITS.result
    })).rejects.toBeInstanceOf(SubscriptionIpcError);
    await writeFile(join(fixture.invocation, 'result.json'), 'x'.repeat(IPC_LIMITS.result + 1));
    await expect(readVerifiedIpcJson({
      directoryPath: fixture.invocation,
      fileName: 'result.json',
      schema: EnvelopeSchema,
      maximumBytes: IPC_LIMITS.result
    })).rejects.toMatchObject({ kind: 'size' });
  });

  // Break: unknown filenames turn the fixed protocol into caller-selected filesystem access.
  it('rejects path escape and non-protocol filenames', async () => {
    const fixture = await fixtureDirectory();
    await expect(readVerifiedIpcJson({
      directoryPath: fixture.invocation,
      fileName: '../result.json',
      schema: EnvelopeSchema,
      maximumBytes: IPC_LIMITS.result
    })).rejects.toMatchObject({ kind: 'path' });
  });
});
