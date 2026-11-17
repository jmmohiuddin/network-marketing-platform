import { z } from 'zod'

const DATE_LENGTH = 10

/** A date (read as 00:00 UTC) or an RFC 3339 instant with offset (PLAN B2 2.4: `effective_from` is an instant). */
export const instant = z.union([z.iso.date(), z.iso.datetime({ offset: true })])

/**
 * The instant as text for a timestamptz parameter: microseconds survive (a JS Date would drop them) and a date is
 * midnight UTC whatever the session time zone.
 */
export function toInstant(value: string): string {
  return value.length === DATE_LENGTH ? `${value}T00:00:00Z` : value
}

export const instantMs = (value: string): number => new Date(toInstant(value)).getTime()

export function startOfTodayUtc(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/** BR-GEN-03: a change is current or future, i.e. not before the start of today (UTC). */
export const notBeforeToday = instant.refine(
  (value) => instantMs(value) >= startOfTodayUtc(),
  'Choose today or a later date.',
)
