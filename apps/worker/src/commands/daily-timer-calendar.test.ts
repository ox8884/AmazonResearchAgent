import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const timerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../ops/systemd/amazon-research-daily.timer'
);

describe('amazon-research-daily timer calendar', () => {
  it('binds OnCalendar to 03:00 America/Chicago instead of host-local time', () => {
    const unit = readFileSync(timerPath, 'utf8');
    const calendar = unit
      .split(/\r?\n/u)
      .find((line) => line.startsWith('OnCalendar='))
      ?.slice('OnCalendar='.length);
    expect(calendar).toBe('*-*-* 03:00:00 America/Chicago');
  });
});
