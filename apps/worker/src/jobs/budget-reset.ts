export function nextBudgetResetAt(now = new Date()): string {
  const zone = 'America/Chicago';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now);
  const start = now.getTime();
  const limit = start + 50 * 60 * 60 * 1000;
  for (let ms = start; ms <= limit; ms += 60 * 1000) {
    const instant = new Date(ms);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(instant);
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour: '2-digit',
        hourCycle: 'h23'
      }).format(instant)
    );
    const minute = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: zone, minute: '2-digit' }).format(instant)
    );
    if (date !== today && hour === 0 && minute === 0) {
      return instant.toISOString();
    }
  }
  throw new Error('Could not resolve next America/Chicago budget reset.');
}
