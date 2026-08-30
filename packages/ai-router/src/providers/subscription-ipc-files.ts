import type { Stats } from 'node:fs';
import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { SubscriptionIpcError } from './subscription-errors';
import type { VerifiedInvocationDirectory } from './subscription-invocation-directory';

const PROTOCOL_NAMES = new Set([
  'request.tmp',
  'request.json',
  'result.tmp',
  'result.json',
  'diagnostic.tmp',
  'diagnostic.json'
]);
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

interface DirectoryTarget {
  readonly directory?: VerifiedInvocationDirectory | undefined;
  readonly directoryPath?: string | undefined;
}

export interface OpenVerifiedRegularFileOptions extends DirectoryTarget {
  readonly fileName: string;
  readonly expectedUid?: number | undefined;
  readonly expectedGid?: number | undefined;
  readonly expectedMode?: number | undefined;
  readonly maximumBytes: number;
}

export interface CreateExclusiveRegularFileOptions extends DirectoryTarget {
  readonly fileName: string;
  readonly mode: number;
  readonly expectedUid?: number | undefined;
  readonly expectedGid?: number | undefined;
}

function modeBits(mode: number): number {
  return mode & 0o7777;
}

export function assertProtocolFileName(fileName: string): void {
  if (basename(fileName) !== fileName || !PROTOCOL_NAMES.has(fileName)) {
    throw new SubscriptionIpcError(
      'IPC filename is not part of the fixed protocol.',
      'path'
    );
  }
}

export function protocolFilePath(
  target: DirectoryTarget,
  fileName: string
): string {
  assertProtocolFileName(fileName);
  if (target.directory !== undefined) {
    return target.directory.protocolPath(fileName);
  }
  if (target.directoryPath === undefined) {
    throw new SubscriptionIpcError('IPC directory is missing.', 'path');
  }
  return join(target.directoryPath, fileName);
}

function verifyIdentity(
  actual: { readonly uid: number; readonly gid: number; readonly mode: number },
  expected: {
    readonly uid?: number | undefined;
    readonly gid?: number | undefined;
    readonly mode?: number | undefined;
  }
): void {
  if (expected.uid !== undefined && actual.uid !== expected.uid) {
    throw new SubscriptionIpcError('IPC object has the wrong owner.', 'ownership');
  }
  if (expected.gid !== undefined && actual.gid !== expected.gid) {
    throw new SubscriptionIpcError('IPC object has the wrong group.', 'ownership');
  }
  if (
    process.platform !== 'win32' &&
    expected.mode !== undefined &&
    modeBits(actual.mode) !== expected.mode
  ) {
    throw new SubscriptionIpcError('IPC object has the wrong mode.', 'mode');
  }
}

async function closeOnError(handle: FileHandle, error: unknown): Promise<never> {
  await handle.close().catch(() => undefined);
  if (error instanceof SubscriptionIpcError) throw error;
  throw new SubscriptionIpcError('IPC operation failed.', 'io', error);
}

export async function createExclusiveRegularFile(
  options: CreateExclusiveRegularFileOptions
): Promise<FileHandle> {
  const path = protocolFilePath(options, options.fileName);
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
      options.mode
    );
  } catch (error) {
    throw new SubscriptionIpcError(
      'Exclusive IPC file creation failed.',
      'io',
      error
    );
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new SubscriptionIpcError(
        'Created IPC object is not a regular file.',
        'type'
      );
    }
    verifyIdentity(info, {
      uid: options.expectedUid,
      gid: options.expectedGid,
      mode: options.mode
    });
    return handle;
  } catch (error) {
    return closeOnError(handle, error);
  }
}

export async function openVerifiedRegularFile(
  options: OpenVerifiedRegularFileOptions
): Promise<FileHandle> {
  const path = protocolFilePath(options, options.fileName);
  let handle: FileHandle;
  let before: Stats;
  try {
    before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new SubscriptionIpcError(
        'IPC object is not a regular file.',
        'type'
      );
    }
    handle = await open(path, constants.O_RDONLY | NO_FOLLOW);
  } catch (error) {
    if (error instanceof SubscriptionIpcError) throw error;
    throw new SubscriptionIpcError('IPC file open failed.', 'io', error);
  }
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.dev !== before.dev ||
      info.ino !== before.ino
    ) {
      throw new SubscriptionIpcError(
        'IPC object changed during verification.',
        'type'
      );
    }
    verifyIdentity(info, {
      uid: options.expectedUid,
      gid: options.expectedGid,
      mode: options.expectedMode
    });
    if (info.size > options.maximumBytes) {
      throw new SubscriptionIpcError(
        'IPC object exceeds its byte limit.',
        'size'
      );
    }
    return handle;
  } catch (error) {
    return closeOnError(handle, error);
  }
}
