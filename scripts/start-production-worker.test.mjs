import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('./start-production-worker.ps1', import.meta.url);
const systemdServiceUrl = new URL(
  '../ops/systemd/amazon-research-worker.service',
  import.meta.url
);

test('production worker imports only its explicit environment allowlist', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  const expected = [
    'APP_SECRET_ENCRYPTION_KEY_B64',
    'JUNGLE_SCOUT_KEY_NAME',
    'JUNGLE_SCOUT_API_KEY',
    'JUNGLE_SCOUT_BASE_URL',
    'JUNGLE_SCOUT_DAILY_LIMIT',
    'JUNGLE_SCOUT_RESERVED_LIMIT',
    'TELEGRAM_BOT_TOKEN',
    'WORKER_ID'
  ];

  for (const name of expected) {
    assert.match(source, new RegExp(`'${name}'`, 'u'));
  }
  assert.match(source, /AllowedNames\.Contains\(\$name\)/u);
  assert.match(source, /Get-ChildItem Env:[\s\S]*SetEnvironmentVariable\(\$_\.Name, \$null, 'Process'\)/u);
  assert.match(source, /\$runtimeEnvironmentNames = @\([\s\S]*'SystemRoot'[\s\S]*'USERPROFILE'/u);
  assert.match(source, /\$runtimeEnvironment\.GetEnumerator\(\)/u);
  assert.match(source, /\$env:NODE_ENV = 'production'/u);
  assert.doesNotMatch(source, /'ADMIN_PASSWORD_SCRYPT'/u);
  assert.doesNotMatch(source, /'CLOUDFLARE_API_TOKEN'/u);
});

test('systemd production worker disables development command profiles', async () => {
  const source = await readFile(systemdServiceUrl, 'utf8');

  assert.match(source, /^Environment=NODE_ENV=production$/mu);
});
