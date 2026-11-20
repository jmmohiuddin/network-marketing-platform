// Output fingerprints for the S-1 byte-identity checks (D-B4-22, D-B6-12): the bench and the equality test use them.
import { createHash } from 'node:crypto'
import { stringifyEngineJson } from '../../src/json.js'
import type { ResultLine, RunOutput } from '../../src/types.js'

/** One line's part of the COMP-style line hash: [payee, pass, rule, origin type, origin id, amount]. */
export const lineHashText = (l: ResultLine): string =>
  `${JSON.stringify([l.payeePositionId, l.pass, l.ruleKey, l.origin?.originType ?? null, l.origin?.originId ?? null, l.amountMinor.toString()])}\n`

/** sha256 over lineHashText of every line, in output order. */
export function linesHashOf(lines: readonly ResultLine[]): string {
  const h = createHash('sha256')
  for (const l of lines) h.update(lineHashText(l))
  return h.digest('hex')
}

/** sha256 over every RunOutput field in declaration order: the field name, then each array element (or the value) as engine JSON. */
export function fullHashOf(output: RunOutput): string {
  const h = createHash('sha256')
  const fields: readonly (keyof RunOutput)[] = [
    'engineVersion', 'planVersionId', 'settingsVersionId', 'snapshotId', 'periodId', 'inputsHash', 'lines', 'payees', 'taxLines', 'qualification',
    'evaluations', 'volumeSummaries', 'constraintApplications', 'capApplications', 'transitionReport', 'controlTotals', 'warnings', 'resultHash',
  ]
  for (const field of fields) {
    const value: unknown = output[field]
    h.update(`\n${field}`)
    for (const item of Array.isArray(value) ? value : [value]) h.update(`\n${stringifyEngineJson(item)}`)
  }
  return h.digest('hex')
}
