import type { CsvTable } from './csv-table.js'

/**
 * Header words that mark personal or bank data (BR-IMP-01, MVP_A V3): the prototype list, national, nationalid and
 * taxid for TS-32 (MVP_A C-18), and the name, contact and payment words the prototype list missed.
 */
const FORBIDDEN_WORDS: ReadonlySet<string> = new Set([
  'name', 'firstname', 'lastname', 'fullname', 'surname', 'givenname', 'email', 'mail', 'phone', 'mobile', 'telephone',
  'tel', 'contact', 'address', 'street', 'postcode', 'postal', 'postalcode', 'zip', 'city', 'nric', 'ic', 'pan',
  'aadhaar', 'ssn', 'tin', 'passport', 'national', 'nationalid', 'taxid', 'vat', 'bank', 'iban', 'account', 'card',
  'swift', 'bic', 'dob', 'birth', 'birthdate',
])

/** Parts that mark such data wherever they appear in a header ('IBANNumber', 'emailaddr', 'HomeAddress1'). */
const FORBIDDEN_PARTS: readonly string[] = ['email', 'phone', 'address', 'bank', 'iban', 'passport', 'birth']

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Values read per column outside the published format, looking for email addresses under another name. */
const CONTENT_SAMPLE_ROWS = 100

/** Header words: camelCase and acronyms split, then lower-cased and split on [^a-z0-9]+ ('bankAccount' -> bank, account). */
export function headerWords(column: string): string[] {
  return column
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '')
}

/** A word, two adjacent words joined ('tax_id', 'e_mail'), the whole header or a strong part names personal data. */
export function isForbiddenColumn(column: string): boolean {
  const words = headerWords(column)
  const joined = words.join('')
  const pairs = words.slice(1).map((word, index) => `${words[index]}${word}`)
  return [...words, ...pairs, joined].some((word) => FORBIDDEN_WORDS.has(word))
    || FORBIDDEN_PARTS.some((part) => joined.includes(part))
}

/** Content sampling (QA E-CPL-01): the column's first values include an email address. */
export function holdsEmailAddresses(table: CsvTable, position: number): boolean {
  return table.records.slice(0, CONTENT_SAMPLE_ROWS).some((record) => EMAIL_LIKE.test((record[position] ?? '').trim()))
}
