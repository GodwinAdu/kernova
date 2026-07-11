/**
 * Built-in Tool: date-time
 *
 * Returns current date, time, timezone, and formatted strings.
 * Supports optional timezone parameter to format output in a specific IANA timezone.
 */

import type { ToolDefinition } from '../plugins/plugin-registry.js';

/**
 * Computes the UTC offset string (e.g., '+05:30', '-04:00') for a given timezone
 * at a specific point in time.
 */
function getUtcOffset(date: Date, timezone: string): string {
  // Format in the target timezone and in UTC, then compute difference
  const utcFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const utcParts = utcFormatter.formatToParts(date);
  const tzParts = tzFormatter.formatToParts(date);

  const getVal = (parts: Intl.DateTimeFormatPart[], type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

  const utcMinutes =
    getVal(utcParts, 'day') * 24 * 60 +
    getVal(utcParts, 'hour') * 60 +
    getVal(utcParts, 'minute');

  const tzMinutes =
    getVal(tzParts, 'day') * 24 * 60 +
    getVal(tzParts, 'hour') * 60 +
    getVal(tzParts, 'minute');

  let diffMinutes = tzMinutes - utcMinutes;

  // Handle day boundary wraparound
  if (diffMinutes > 12 * 60) {
    diffMinutes -= 24 * 60;
  } else if (diffMinutes < -12 * 60) {
    diffMinutes += 24 * 60;
  }

  const sign = diffMinutes >= 0 ? '+' : '-';
  const absDiff = Math.abs(diffMinutes);
  const hours = Math.floor(absDiff / 60);
  const minutes = absDiff % 60;

  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function createDateTimeTool(): ToolDefinition {
  return {
    id: 'date-time',
    name: 'Date Time',
    description:
      'Return current date, time, timezone, and formatted strings. Optionally formats output in a specific IANA timezone.',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['iso', 'unix', 'locale'],
          default: 'iso',
          description:
            'Output format preference: iso (ISO 8601), unix (timestamp), locale (localized string)',
        },
        timezone: {
          type: 'string',
          description:
            'IANA timezone identifier (e.g., "America/New_York"). Defaults to system timezone.',
        },
      },
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const timezone =
        (params.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const now = new Date();

      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        weekday: 'long',
      });

      const parts = formatter.formatToParts(now);
      const get = (type: string) => parts.find((p) => p.type === type)?.value || '';

      const date = `${get('year')}-${get('month')}-${get('day')}`;
      const time = `${get('hour')}:${get('minute')}:${get('second')}`;
      const dayOfWeek = get('weekday');
      const offset = getUtcOffset(now, timezone);

      // Build ISO string in the target timezone
      const iso = `${date}T${time}${offset}`;

      return {
        iso,
        unix: Math.floor(now.getTime() / 1000),
        unixMs: now.getTime(),
        date,
        time,
        timezone,
        offset,
        dayOfWeek,
      };
    },
  };
}

/** Pre-built date-time tool instance for convenience. */
export const dateTimeTool: ToolDefinition = createDateTimeTool();
