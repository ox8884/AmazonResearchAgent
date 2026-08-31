#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

function fail(message) {
  process.stderr.write(`subscription-install-lock: ${message}\n`);
  process.exitCode = 1;
}

async function main() {
  const [lockPath, ownerMode, ...command] = process.argv.slice(2);
  if (!lockPath || !['fixture', 'root'].includes(ownerMode) || command.length === 0) {
    throw new TypeError('closed lock opener arguments rejected');
  }
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw new TypeError('O_NOFOLLOW unavailable');
  const validate = async () => {
    const descriptor = await handle.stat({ bigint: true });
    const path = await lstat(lockPath, { bigint: true });
    if (!descriptor.isFile() || descriptor.isSymbolicLink() || !path.isFile() || path.isSymbolicLink() ||
        descriptor.dev !== path.dev || descriptor.ino !== path.ino ||
        (descriptor.mode & 0o777n) !== (path.mode & 0o777n) ||
        (ownerMode === 'root' && (descriptor.uid !== 0n || descriptor.gid !== 0n || (descriptor.mode & 0o777n) !== 0o600n))) {
      throw new TypeError('lock authority or descriptor identity rejected');
    }
  };
  let handle;
  let created = false;
  try {
    try {
      handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
      created = true;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      handle = await open(lockPath, constants.O_RDWR | constants.O_NOFOLLOW);
    }
    if (created) await handle.chmod(0o600);
    await validate();
    const child = spawn(command[0], command.slice(1), {
      stdio: ['inherit', 'inherit', 'inherit', handle.fd],
      env: { ...process.env, ARA_TRANSACTION_LOCK_FD: '3' },
      windowsHide: true
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(signal === null ? (code ?? 1) : 1));
    });
    await validate();
  } finally {
    await handle?.close();
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : 'lock opener failed'));
