import { constants } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { SubscriptionIpcError } from './subscription-errors';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const DIRECTORY = constants.O_DIRECTORY ?? 0;

export class VerifiedInvocationDirectory {
  readonly path: string;
  readonly uid: number;
  readonly gid: number;
  readonly mode: number;
  readonly descriptor: number;
  private readonly handle: FileHandle;
  private closed = false;

  private constructor(
    path: string,
    uid: number,
    gid: number,
    mode: number,
    handle: FileHandle
  ) {
    this.path = path;
    this.uid = uid;
    this.gid = gid;
    this.mode = mode;
    this.handle = handle;
    this.descriptor = handle.fd;
  }

  static async open(options: VerifyInvocationDirectoryOptions): Promise<VerifiedInvocationDirectory> {
    const root = resolve(options.expectedRoot);
    const path = resolve(options.directoryPath);
    const delta = relative(root, path);
    if (
      !UUID_PATTERN.test(options.instanceId) ||
      !isAbsolute(options.directoryPath) ||
      !isAbsolute(options.expectedRoot) ||
      path !== join(root, options.instanceId) ||
      delta === '' ||
      delta === '..' ||
      delta.startsWith(`..${sep}`) ||
      isAbsolute(delta)
    ) {
      throw new SubscriptionIpcError(
        'Invocation path does not match its UUID identity.',
        'path'
      );
    }
    let handle: FileHandle | undefined;
    try {
      const before = await lstat(options.directoryPath);
      if (!before.isDirectory() || before.isSymbolicLink()) {
        throw new SubscriptionIpcError(
          'Invocation path is not a real directory.',
          'type'
        );
      }
      handle = await open(options.directoryPath, constants.O_RDONLY | DIRECTORY | NO_FOLLOW);
      const info = await handle.stat();
      if (
        !info.isDirectory() ||
        info.dev !== before.dev ||
        info.ino !== before.ino
      ) {
        throw new SubscriptionIpcError(
          'Invocation directory changed during verification.',
          'type'
        );
      }
      const [canonicalRoot, canonicalDirectory] = await Promise.all([
        realpath(options.expectedRoot),
        realpath(options.directoryPath)
      ]);
      if (canonicalDirectory !== join(canonicalRoot, options.instanceId)) {
        throw new SubscriptionIpcError(
          'Invocation directory escaped its root.',
          'path'
        );
      }
      verifyIdentity(info, options);
      return new VerifiedInvocationDirectory(
        options.directoryPath,
        info.uid,
        info.gid,
        modeBits(info.mode),
        handle
      );
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (error instanceof SubscriptionIpcError) throw error;
      throw new SubscriptionIpcError(
        'Invocation directory verification failed.',
        'io',
        error
      );
    }
  }

  protocolPath(fileName: string): string {
    if (this.closed) {
      throw new SubscriptionIpcError(
        'Invocation directory handle is closed.',
        'io'
      );
    }
    return process.platform === 'linux'
      ? `/proc/self/fd/${this.descriptor}/${fileName}`
      : join(this.path, fileName);
  }

  async sync(): Promise<void> {
    try {
      await this.handle.sync();
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

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close();
  }
}

export interface VerifyInvocationDirectoryOptions {
  readonly directoryPath: string;
  readonly expectedRoot: string;
  readonly instanceId: string;
  readonly expectedUid?: number | undefined;
  readonly expectedGid?: number | undefined;
  readonly expectedMode: number;
}

function modeBits(mode: number): number {
  return mode & 0o7777;
}

function verifyIdentity(
  info: { readonly uid: number; readonly gid: number; readonly mode: number },
  options: VerifyInvocationDirectoryOptions
): void {
  if (options.expectedUid !== undefined && info.uid !== options.expectedUid) {
    throw new SubscriptionIpcError(
      'Invocation directory has the wrong owner.',
      'ownership'
    );
  }
  if (options.expectedGid !== undefined && info.gid !== options.expectedGid) {
    throw new SubscriptionIpcError(
      'Invocation directory has the wrong group.',
      'ownership'
    );
  }
  if (
    process.platform !== 'win32' &&
    modeBits(info.mode) !== options.expectedMode
  ) {
    throw new SubscriptionIpcError(
      'Invocation directory has the wrong mode.',
      'mode'
    );
  }
}

export async function verifyInvocationDirectory(
  options: VerifyInvocationDirectoryOptions
): Promise<VerifiedInvocationDirectory> {
  return VerifiedInvocationDirectory.open(options);
}
