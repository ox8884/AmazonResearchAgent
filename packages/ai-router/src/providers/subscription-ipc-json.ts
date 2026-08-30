import { constants } from 'node:fs';
import { open, rename, stat } from 'node:fs/promises';
import type { z } from 'zod';
import { SubscriptionIpcError } from './subscription-errors';
import {
  createExclusiveRegularFile,
  openVerifiedRegularFile,
  protocolFilePath,
  type OpenVerifiedRegularFileOptions
} from './subscription-ipc-files';
import type { VerifiedInvocationDirectory } from './subscription-invocation-directory';

interface AtomicDirectoryTarget {
  readonly directory?: VerifiedInvocationDirectory | undefined;
  readonly directoryPath?: string | undefined;
}

export interface WriteAtomicIpcJsonOptions<T> extends AtomicDirectoryTarget {
  readonly temporaryName: string;
  readonly finalName: string;
  readonly value: T;
  readonly schema: z.ZodType<T>;
  readonly maximumBytes: number;
  readonly mode: number;
  readonly expectedUid?: number | undefined;
  readonly expectedGid?: number | undefined;
}

export interface ReadVerifiedIpcJsonOptions<T>
  extends OpenVerifiedRegularFileOptions {
  readonly schema: z.ZodType<T>;
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await stat(path);
    throw new SubscriptionIpcError('Final IPC object already exists.', 'path');
  } catch (error) {
    if (error instanceof SubscriptionIpcError) throw error;
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw new SubscriptionIpcError(
        'Final IPC path verification failed.',
        'io',
        error
      );
    }
  }
}

async function syncDirectory(options: AtomicDirectoryTarget): Promise<void> {
  if (options.directory !== undefined) {
    await options.directory.sync();
    return;
  }
  if (options.directoryPath === undefined) {
    throw new SubscriptionIpcError('IPC directory is missing.', 'path');
  }
  const directory = await open(options.directoryPath, constants.O_RDONLY);
  try {
    try {
      await directory.sync();
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
  } finally {
    await directory.close();
  }
}

export async function writeAtomicIpcJson<T>(
  options: WriteAtomicIpcJsonOptions<T>
): Promise<void> {
  const temporaryPath = protocolFilePath(options, options.temporaryName);
  const finalPath = protocolFilePath(options, options.finalName);
  const payload = Buffer.from(
    JSON.stringify(options.schema.parse(options.value)),
    'utf8'
  );
  if (payload.byteLength > options.maximumBytes) {
    throw new SubscriptionIpcError(
      'IPC payload exceeds its byte limit.',
      'size'
    );
  }
  await assertAbsent(finalPath);
  const handle = await createExclusiveRegularFile({
    directory: options.directory,
    directoryPath: options.directoryPath,
    fileName: options.temporaryName,
    mode: options.mode,
    expectedUid: options.expectedUid,
    expectedGid: options.expectedGid
  });
  try {
    await handle.writeFile(payload);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, finalPath);
    await syncDirectory(options);
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw new SubscriptionIpcError(
      'Atomic IPC publication failed.',
      'io',
      error
    );
  }
}

export async function readVerifiedIpcJson<T>(
  options: ReadVerifiedIpcJsonOptions<T>
): Promise<T> {
  const handle = await openVerifiedRegularFile(options);
  try {
    const buffer = await handle.readFile();
    if (buffer.byteLength > options.maximumBytes) {
      throw new SubscriptionIpcError(
        'IPC object exceeds its byte limit.',
        'size'
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(buffer.toString('utf8'));
    } catch (error) {
      throw new SubscriptionIpcError(
        'IPC object is not valid JSON.',
        'schema',
        error
      );
    }
    const parsed = options.schema.safeParse(value);
    if (!parsed.success) {
      throw new SubscriptionIpcError(
        'IPC envelope does not match the protocol.',
        'schema',
        parsed.error
      );
    }
    return parsed.data;
  } finally {
    await handle.close();
  }
}
