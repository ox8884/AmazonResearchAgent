#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const probePrompt = 'Classify pancake dispenser bottle as structured JSON.';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeCommand = path.join(root, 'tests', 'fixtures', 'fake-ai-command.mjs');

class ProbeError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'ProbeError';
  }
}

function parseProvider(argv) {
  const index = argv.indexOf('--provider');
  const provider = index >= 0 ? argv[index + 1] : undefined;
  if (provider !== 'custom-http' && provider !== 'fake-command') {
    throw new ProbeError('Use --provider custom-http or --provider fake-command.');
  }
  return provider;
}

function appendOutput(current, chunk) {
  const next = current + chunk;
  if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT_BYTES) {
    throw new ProbeError('Probe output exceeded the capture limit.');
  }
  return next;
}

function runCommand({ executable, args, input, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const child = spawn(executable, [...args], {
    shell: false,
    env: { NODE_ENV: 'production' },
    stdio: 'pipe',
    windowsHide: true
  });
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new ProbeError('Command timeout.'));
      }
    }, timeoutMs);
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      try {
        stdout = appendOutput(stdout, chunk);
      } catch (error) {
        child.kill();
        fail(error);
      }
    });
    child.stderr.on('data', (chunk) => {
      try {
        stderr = appendOutput(stderr, chunk);
      } catch (error) {
        child.kill();
        fail(error);
      }
    });
    child.once('error', (error) => fail(new ProbeError('Command failed to start.', error)));
    child.once('close', (code) => {
      if (settled) return;
      clearTimeout(timer);
      if (code !== 0) {
        fail(new ProbeError('Command exited unsuccessfully.'));
        return;
      }
      settled = true;
      resolve({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function parseStructuredOutput(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new ProbeError('Structured output was not a JSON object.');
  }
  const parsed = JSON.parse(stdout.slice(start, end + 1));
  if (parsed?.classification !== 'product_niche') {
    throw new ProbeError('Structured output did not contain the expected classification.');
  }
  return parsed;
}

function requestHttp(url, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = (target.protocol === 'https:' ? import('node:https') : import('node:http'));
    request.then(({ request: makeRequest }) => {
      const clientRequest = makeRequest(
        {
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method,
          headers: body
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
            : undefined
        },
        (response) => {
          let output = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            try {
              output = appendOutput(output, chunk);
            } catch (error) {
              clientRequest.destroy();
              reject(error);
            }
          });
          response.once('end', () => {
            if ((response.statusCode ?? 500) >= 400) {
              reject(new ProbeError('HTTP probe returned an error status.'));
              return;
            }
            resolve({ statusCode: response.statusCode ?? 0, body: output });
          });
        }
      );
      const timer = setTimeout(() => {
        clientRequest.destroy();
        reject(new ProbeError('HTTP timeout.'));
      }, timeoutMs);
      clientRequest.once('error', (error) => {
        clearTimeout(timer);
        reject(new ProbeError('HTTP probe failed.', error));
      });
      clientRequest.once('close', () => clearTimeout(timer));
      if (body) clientRequest.write(body);
      clientRequest.end();
    }).catch((error) => reject(new ProbeError('HTTP client failed to load.', error)));
  });
}

async function startMockHttpProvider() {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'fake-http-model' }] }));
      return;
    }
    if (request.url === '/v1/chat/completions') {
      response.end(JSON.stringify({
        choices: [{ message: { content: '{"classification":"product_niche"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 }
      }));
      return;
    }
    if (request.url === '/v1/slow') {
      setTimeout(() => response.end('{}'), 100);
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`
  };
}

async function probeFakeCommand() {
  const executable = process.execPath;
  const version = await runCommand({
    executable,
    args: [fakeCommand, '--version'],
    input: ''
  });
  const structured = await runCommand({
    executable,
    args: [fakeCommand],
    input: probePrompt
  });
  const timeout = await runCommand({
    executable,
    args: [fakeCommand, '--sleep=100'],
    input: probePrompt,
    timeoutMs: 20
  }).then(() => false).catch((error) => error instanceof ProbeError && error.message === 'Command timeout.');
  parseStructuredOutput(structured.stdout);
  if (!version.stdout.includes('fake-ai-command')) throw new ProbeError('Version probe failed.');
  if (!timeout) throw new ProbeError('Command timeout probe failed.');
  return { executable: path.basename(executable), version: version.stdout.trim(), structuredJson: true, unattended: true, timeout: true };
}

async function probeCustomHttp() {
  const mock = await startMockHttpProvider();
  try {
    const models = await requestHttp(`${mock.baseUrl}/models`);
    const structured = await requestHttp(`${mock.baseUrl}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ model: 'fake-http-model', messages: [{ role: 'user', content: probePrompt }] })
    });
    const timeout = await requestHttp(`${mock.baseUrl}/slow`, { timeoutMs: 20 })
      .then(() => false)
      .catch((error) => error instanceof ProbeError && error.message === 'HTTP timeout.');
    const modelBody = JSON.parse(models.body);
    const structuredBody = JSON.parse(structured.body);
    if (modelBody.data?.[0]?.id !== 'fake-http-model') throw new ProbeError('Model discovery failed.');
    if (!structuredBody.choices?.[0]?.message?.content?.includes('product_niche')) {
      throw new ProbeError('Structured HTTP probe failed.');
    }
    if (!timeout) throw new ProbeError('HTTP timeout probe failed.');
    return { baseUrl: 'local mock only', version: 'fake-http-model', structuredJson: true, unattended: true, timeout: true };
  } finally {
    mock.server.close();
  }
}

async function main() {
  const provider = parseProvider(process.argv.slice(2));
  const result = provider === 'fake-command' ? await probeFakeCommand() : await probeCustomHttp();
  console.log(JSON.stringify({
    provider,
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    oracleArm64: process.platform === 'linux' && process.arch === 'arm64',
    ...result
  }));
}

main().catch((error) => {
  console.error(error instanceof ProbeError ? error.message : 'Provider probe failed.');
  process.exitCode = 1;
});
