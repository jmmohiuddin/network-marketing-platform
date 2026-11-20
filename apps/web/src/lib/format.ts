// Formatting shared by every screen: one date-time style, counted nouns and exact minor-unit decimals.
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const NUMBER = new Intl.NumberFormat()

/** A timestamp in the user's locale ("Nov 12, 2026, 6:55 AM"), the app's one date-time format; "—" when absent. */
export function formatDateTime(value: string | null | undefined): string {
  return value === null || value === undefined ? '—' : DATE_TIME.format(new Date(value))
}

/**
 * An instant in a zone (the viewer's when none), with the zone named: "Aug 1, 2026, 12:00 AM GMT+2". For period
 * bounds and effective times, whose wall-clock meaning depends on the zone (BUG-091).
 */
export function formatDateTimeIn(value: string, timeZone: string | undefined): string {
  // dateStyle/timeStyle cannot be combined with timeZoneName: the fields are named one by one.
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' }).format(new Date(value))
}

/** The calendar day of an instant in a zone (the viewer's when none): "Jan 1, 2027". Never the UTC day of an ISO string. */
export function formatDateIn(value: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone }).format(new Date(value))
}

/** A calendar date (YYYY-MM-DD, a day with no zone) in the user's locale: "Oct 31, 2026", never shifted to another day. */
export function formatDay(day: string): string {
  return formatDateIn(`${day}T00:00:00Z`, 'UTC')
}

/** A count with its noun in the right number: (1, 'market') -> "1 market", (3, 'batch', 'batches') -> "3 batches". */
export function countLabel(count: number, one: string, many = `${one}s`): string {
  return `${NUMBER.format(count)} ${count === 1 ? one : many}`
}

/** "-12345" with 2 decimals -> "-123.45": exact string arithmetic on minor units. */
export function minorToDecimal(minor: string, minorUnit: number): string {
  const negative = minor.startsWith('-')
  const digits = (negative ? minor.slice(1) : minor).replace(/^\+/, '').padStart(minorUnit + 1, '0')
  const whole = digits.slice(0, digits.length - minorUnit)
  const fraction = minorUnit === 0 ? '' : `.${digits.slice(-minorUnit)}`
  return `${negative ? '-' : ''}${whole}${fraction}`
}
