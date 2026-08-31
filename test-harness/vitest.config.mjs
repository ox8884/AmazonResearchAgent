import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { defineConfig } from 'vitest/config';
import { INTEGRATION_TEST_GLOBS, isIntegrationTestPath } from './harness-boundaries.mjs';

const root = process.cwd();
const harnessDirectory = import.meta.dirname;

function collectIntegrationFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectIntegrationFiles(path));
    } else if (isIntegrationTestPath(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function projectName(file) {
  const relativeFile = relative(root, file).split(sep).join('/');
  return `integration-${relativeFile}`;
}

const integrationFiles = collectIntegrationFiles(resolve(root, 'src'));
const integrationProjects = integrationFiles.map((file) => ({
  test: {
    name: projectName(file),
    root,
    include: [relative(root, file).split(sep).join('/')],
    globalSetup: [resolve(harnessDirectory, 'isolated-integration-global-setup.mjs')],
    setupFiles: [resolve(harnessDirectory, 'isolated-integration-setup.mjs')],
  },
}));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          root,
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: INTEGRATION_TEST_GLOBS,
        },
      },
      ...integrationProjects,
    ],
  },
});
