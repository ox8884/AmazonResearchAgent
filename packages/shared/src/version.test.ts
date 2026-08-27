import { describe, expect, it } from 'vitest';
import { APP_NAME } from './version';

describe('shared package', () => {
  it('exports the application name', () => {
    expect(APP_NAME).toBe('Amazon Research Agent');
  });
});
