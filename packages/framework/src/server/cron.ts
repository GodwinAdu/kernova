/**
 * Lightweight Cron Parser — No dependencies.
 *
 * Supports standard 5-field cron syntax:
 *   ┌───────────── minute (0-59)
 *   │ ┌───────────── hour (0-23)
 *   │ │ ┌───────────── day of month (1-31)
 *   │ │ │ ┌───────────── month (1-12)
 *   │ │ │ │ ┌───────────── day of week (0-6, 0=Sunday)
 *   │ │ │ │ │
 *   * * * * *
 *
 * Also supports:
 *   - Ranges: 1-5
 *   - Lists: 1,3,5
 *   - Steps: star/5 (every 5)
 *   - Special: at-hourly, at-daily, at-weekly, at-monthly
 *
 * Usage:
 *   const next = getNextCronTime('0 9 * * 1-5'); // Next 9am on a weekday
 *   const matches = cronMatches('star/5 * * * *', new Date()); // Every 5 min
 */

export function cronMatches(expression: string, date: Date = new Date()): boolean {
  const resolved = resolveSpecial(expression);
  const parts = resolved.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;

  return (
    fieldMatches(minExpr, date.getMinutes(), 0, 59) &&
    fieldMatches(hourExpr, date.getHours(), 0, 23) &&
    fieldMatches(domExpr, date.getDate(), 1, 31) &&
    fieldMatches(monthExpr, date.getMonth() + 1, 1, 12) &&
    fieldMatches(dowExpr, date.getDay(), 0, 6)
  );
}

export function getNextCronTime(expression: string, from: Date = new Date()): Date {
  const date = new Date(from.getTime() + 60000); // Start from next minute
  date.setSeconds(0, 0);

  // Search up to 366 days ahead
  const maxAttempts = 366 * 24 * 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (cronMatches(expression, date)) {
      return date;
    }
    date.setTime(date.getTime() + 60000); // Advance 1 minute
  }

  // Fallback: 24 hours from now
  return new Date(from.getTime() + 86400000);
}

export function getCronIntervalMs(expression: string): number {
  // For simple patterns, calculate approximate interval
  const resolved = resolveSpecial(expression);

  // Check common patterns
  if (resolved === '* * * * *') return 60000; // Every minute
  if (/^\*\/(\d+) \* \* \* \*$/.test(resolved)) {
    const mins = parseInt(resolved.match(/^\*\/(\d+)/)?.[1] || '1');
    return mins * 60000;
  }
  if (/^0 \* \* \* \*$/.test(resolved)) return 3600000; // Every hour
  if (/^0 \*\/(\d+) \* \* \*$/.test(resolved)) {
    const hours = parseInt(resolved.match(/\*\/(\d+)/)?.[1] || '1');
    return hours * 3600000;
  }
  if (/^0 0 \* \* \*$/.test(resolved)) return 86400000; // Daily
  if (/^0 0 \* \* 0$/.test(resolved)) return 604800000; // Weekly

  // For complex patterns, compute difference between next two occurrences
  const now = new Date();
  const next1 = getNextCronTime(expression, now);
  const next2 = getNextCronTime(expression, next1);
  return next2.getTime() - next1.getTime();
}

// ─── Internal Helpers ─────────────────────────────────────

function resolveSpecial(expression: string): string {
  switch (expression.toLowerCase()) {
    case '@yearly': case '@annually': return '0 0 1 1 *';
    case '@monthly': return '0 0 1 * *';
    case '@weekly': return '0 0 * * 0';
    case '@daily': case '@midnight': return '0 0 * * *';
    case '@hourly': return '0 * * * *';
    default: return expression;
  }
}

function fieldMatches(expr: string, value: number, min: number, max: number): boolean {
  if (expr === '*') return true;

  // Handle lists (1,3,5)
  const parts = expr.split(',');
  for (const part of parts) {
    if (partMatches(part.trim(), value, min, max)) return true;
  }
  return false;
}

function partMatches(part: string, value: number, min: number, max: number): boolean {
  // Step: */5 or 1-10/2
  if (part.includes('/')) {
    const [rangeStr, stepStr] = part.split('/');
    const step = parseInt(stepStr);
    if (isNaN(step) || step <= 0) return false;

    if (rangeStr === '*') {
      return (value - min) % step === 0;
    }

    const [start, end] = parseRange(rangeStr, min, max);
    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  }

  // Range: 1-5
  if (part.includes('-')) {
    const [start, end] = parseRange(part, min, max);
    return value >= start && value <= end;
  }

  // Single value
  return parseInt(part) === value;
}

function parseRange(expr: string, min: number, max: number): [number, number] {
  const [startStr, endStr] = expr.split('-');
  const start = startStr === '*' ? min : parseInt(startStr);
  const end = endStr ? parseInt(endStr) : max;
  return [start, end];
}
