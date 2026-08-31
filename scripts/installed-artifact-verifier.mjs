import { createHash } from 'node:crypto';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const metadata = (info) => ({
  dev: info.dev, ino: info.ino, uid: info.uid, gid: info.gid, mode: info.mode,
  size: info.size, mtimeNs: info.mtimeNs, ctimeNs: info.ctimeNs, regular: info.isFile()
});
const sameMetadata = (left, right) => left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.gid === right.gid &&
  left.mode === right.mode && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.regular && right.regular;

export async function verifyInstalledArtifactsCore(authority, paths, fs) {
  if (!Number.isInteger(fs.constants.O_NOFOLLOW)) throw new TypeError('Required O_NOFOLLOW primitive unavailable.');
  const verified = [];
  for (const path of paths) {
    const beforePath = await fs.lstat(path, { bigint: true });
    if (!beforePath.isFile() || beforePath.isSymbolicLink()) throw new TypeError('Installed artifact type rejected.');
    const handle = await fs.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const beforeDescriptor = await handle.stat({ bigint: true });
      if (!sameMetadata(metadata(beforePath), metadata(beforeDescriptor)) || beforeDescriptor.uid !== 0n || beforeDescriptor.gid !== 0n) {
        throw new TypeError('Installed artifact type, identity, or owner rejected.');
      }
      const expected = authority.artifacts[path];
      const mode = `0${(Number(beforeDescriptor.mode) & 0o777).toString(8)}`;
      if (mode !== expected.mode) throw new TypeError('Installed artifact mode rejected.');
      const bytes = await handle.readFile();
      const afterDescriptor = await handle.stat({ bigint: true });
      if (!sameMetadata(metadata(beforeDescriptor), metadata(afterDescriptor)) || BigInt(bytes.length) !== beforeDescriptor.size) {
        throw new TypeError('Installed artifact changed during descriptor read.');
      }
      if (sha256(bytes) !== expected.sha256) throw new TypeError('Installed artifact digest rejected.');
      const afterPath = await fs.lstat(path, { bigint: true });
      if (!sameMetadata(metadata(afterDescriptor), metadata(afterPath))) throw new TypeError('Installed artifact path changed during verification.');
      verified.push({ path, sha256: expected.sha256, mode });
    } finally {
      await handle.close();
    }
  }
  return Object.freeze(verified);
}
