import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CommandProvider } from './command';

const fixturePath = fileURLToPath(
  new URL('../../../../tests/fixtures/fake-ai-command.mjs', import.meta.url)
);
const executable = process.execPath;

const OutputSchema = z.object({
  classification: z.enum(['product_niche', 'brand_ip']),
  received: z.string()
});

function provider(overrides: Partial<ConstructorParameters<typeof CommandProvider>[0]> = {}) {
  return new CommandProvider({
    id: 'fake-command',
    billingType: 'subscription',
    executable,
    fixedArgs: [fixturePath],
    modelId: 'fake-command-model',
    promptMode: 'stdin',
    outputMode: 'json',
    environmentAllowlist: [],
    ...overrides
  });
}

describe('command AI provider', () => {
  it('executes a structured request through stdin', async () => {
    const result = await provider().runStructured({
      role: 'niche_normalization',
      modelId: 'fake-command-model',
      locale: 'ko',
      prompt: 'pancake dispenser bottle',
      inputHash: 'c'.repeat(64),
      schema: OutputSchema
    });

    expect(result.output.classification).toBe('product_niche');
    expect(result.output.received).toBe('pancake dispenser bottle');
  });

  it('passes shell metacharacters as data with shell disabled', async () => {
    const prompt = '$(node -e "process.exit(1)")';
    const result = await provider().runStructured({
      role: 'niche_normalization',
      modelId: 'fake-command-model',
      locale: 'en',
      prompt,
      inputHash: 'd'.repeat(64),
      schema: OutputSchema
    });

    expect(result.output.received).toBe(prompt);
  });

  it('kills a command that exceeds the configured timeout', async () => {
    await expect(
      provider({ fixedArgs: [fixturePath, '--sleep=100'], timeoutMs: 20 }).runStructured({
        role: 'niche_normalization',
        modelId: 'fake-command-model',
        locale: 'ko',
        prompt: 'pancake dispenser bottle',
        inputHash: 'e'.repeat(64),
        schema: OutputSchema
      })
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
