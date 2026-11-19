/** Minor units as a decimal amount with the market's digits, by string arithmetic only (TS-67): '2300', 2 -> '23.00'. */
export function formatMinor(minor: string, digits: number): string {
  const negative = minor.startsWith('-')
  const magnitude = (negative ? minor.slice(1) : minor).padStart(digits + 1, '0')
  const whole = magnitude.slice(0, magnitude.length - digits)
  const decimal = digits === 0 ? whole : `${whole}.${magnitude.slice(-digits)}`
  return negative ? `-${decimal}` : decimal
}

/** API money format (decimal strings of minor units). */
export const MINOR = /^(0|[1-9]\d{0,17})$/
