import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectCodexAuthHome,
  inspectCodexCredentialSource
} from './subscription-auth-home';

const roots: string[] = [];

async function authFixture(): Promise<string> {
  const path = join(tmpdir(), `ara-codex-auth-${randomUUID()}`);
  roots.push(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Codex auth home and credential source', () => {
  // Break: symlinked shared or human auth homes are accepted.
  it('requires a dedicated real 0700 Codex auth home', async () => {
    const path = await authFixture();
    await expect(inspectCodexAuthHome(path, {
      expectedUid: process.getuid?.(),
      expectedGid: process.getgid?.()
    })).resolves.toMatchObject({ path, mode: process.platform === 'win32' ? 0o666 : 0o700 });

    const link = `${path}-link`;
    roots.push(link);
    await symlink(path, link, 'dir');
    await expect(inspectCodexAuthHome(link, {
      expectedUid: process.getuid?.(),
      expectedGid: process.getgid?.()
    })).rejects.toMatchObject({ failureClass: 'profile_mismatch' });
  });

  // Break: API key environment fallback or custom endpoint is classified as subscription auth.
  it('rejects API keys tokens custom endpoints and provider overrides', async () => {
    const path = await authFixture();
    await writeFile(join(path, 'credential-source.json'), JSON.stringify({
      kind: 'chatgpt_subscription',
      authenticated: true,
      endpoint: 'official',
      providerOverride: null
    }), { mode: 0o600 });
    await expect(inspectCodexCredentialSource(path, {})).resolves.toMatchObject({
      kind: 'chatgpt_subscription',
      authenticated: true
    });

    for (const environment of [
      { OPENAI_API_KEY: 'secret' },
      { CODEX_ACCESS_TOKEN: 'secret' },
      { OPENAI_BASE_URL: 'https://example.invalid' },
      { CODEX_PROVIDER: 'custom' }
    ]) {
      await expect(inspectCodexCredentialSource(path, environment)).rejects.toMatchObject({
        failureClass: 'credential_source_mismatch'
      });
    }
  });

  // Break: missing or unauthenticated effective source reports Ready.
  it('keeps missing or unauthenticated evidence unavailable', async () => {
    const path = await authFixture();
    await expect(inspectCodexCredentialSource(path, {})).rejects.toMatchObject({
      state: 'authorization_required'
    });
    await writeFile(join(path, 'credential-source.json'), JSON.stringify({
      kind: 'chatgpt_subscription',
      authenticated: false,
      endpoint: 'official',
      providerOverride: null
    }));
    await expect(inspectCodexCredentialSource(path, {})).rejects.toMatchObject({
      state: 'authorization_required'
    });
  });
});
