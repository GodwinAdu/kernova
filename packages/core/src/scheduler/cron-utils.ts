/**
 * Kernova Cron Utilities
 *
 * Validation and scheduling helpers using cron-parser.
 * Supports standard 5-field cron expressions (minute, hour, day-of-month, month, day-of-week).
 */

import cronParser from 'cron-parser';
const { parseExpression } = cronParser;

/**
 * Validate a cron expression string.
 * Accepts standard 5-field cron expressions with special characters: *, ',', -, /
 *
 * @param expr - The cron expression to validate
 * @returns true if the expression is a valid 5-field cron
 */
export function isValidCron(expr: string): boolean {
  try {
    // cron-parser supports 5 and 6 field (with seconds) cron expressions.
    // We only accept 5-field cron. Quick field count check before parsing.
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5) {
      return false;
    }
    parseExpression(expr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the next occurrence date for a cron expression.
 *
 * @param expr - A valid 5-field cron expression
 * @param after - The reference date (defaults to now)
 * @returns The next Date when the cron expression matches
 * @throws Error if the cron expression is invalid
 */
export function getNextCronDate(expr: string, after?: Date): Date {
  const options = after ? { currentDate: after } : undefined;
  const interval = parseExpression(expr, options);
  return interval.next().toDate();
}
