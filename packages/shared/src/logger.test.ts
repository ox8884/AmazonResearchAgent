import { describe, expect, it } from 'vitest';
import { formatLog } from './logger';

describe('structured logger', () => {
  it('redacts known secret field names recursively', () => {
    const line = formatLog({
      apiKey: 'abc',
      authorization: 'AI:secret',
      nested: { token: 'xyz' }
    });
    expect(line).not.toContain('abc');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('xyz');
    expect(line).toContain('[REDACTED]');
  });
});
