import { requiredError } from '../../lib/validation'

/** YYYY-MM with month 01-12; MONTH_PATTERN is the same rule for the input's pattern attribute. */
export const MONTH_PATTERN = '\\d{4}-(0[1-9]|1[0-2])'
const MONTH = new RegExp(`^${MONTH_PATTERN}$`)

function monthError(label: string, value: string): string | null {
  return requiredError(label, value) ?? (MONTH.test(value.trim()) ? null : `Enter ${label} as year and month, for example 2025-01.`)
}

/** A period range of whole months, as the import and snapshot APIs take it (YYYY-MM, from <= to). */
export function periodErrors(from: string, to: string): { period_from?: string; period_to?: string } {
  const fromError = monthError('the first month', from)
  const toError = monthError('the last month', to)
  if (fromError === null && toError === null && to.trim() < from.trim()) {
    return { period_to: 'The last month must not be before the first month.' }
  }
  return { ...(fromError === null ? {} : { period_from: fromError }), ...(toError === null ? {} : { period_to: toError }) }
}
