// Formatting shared by every screen: one date-time style and counted nouns.
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const NUMBER = new Intl.NumberFormat()

/** A timestamp in the user's locale ("Nov 12, 2026, 6:55 AM"), the app's one date-time format; "—" when absent. */
export function formatDateTime(value: string | null | undefined): string {
  return value === null || value === undefined ? '—' : DATE_TIME.format(new Date(value))
}

/** A count with its noun in the right number: (1, 'market') -> "1 market", (3, 'batch', 'batches') -> "3 batches". */
export function countLabel(count: number, one: string, many = `${one}s`): string {
  return `${NUMBER.format(count)} ${count === 1 ? one : many}`
}
