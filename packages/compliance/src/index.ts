import { buildContext } from './context.js'
import { METHOD_VERSION } from './figure.js'
import { computeR1 } from './r1.js'
import { computeR2 } from './r2.js'
import { computeR3Month, computeR3Year } from './r3.js'
import { computeR4 } from './r4.js'
import { computeR5 } from './r5.js'
import type { ComplianceConfigInput, ComplianceFacts, ComplianceReports, ComputeOptions } from './types.js'

export type * from './types.js'
export { DEFAULT_DRILL_ID_CAP, METHOD_VERSION } from './figure.js'
export { percent } from './percent.js'
export { ComplianceInputError } from './validate.js'

/**
 * Computes indicator reports R1-R5 from loaded facts. Pure and deterministic: the same facts and
 * settings always give the same figures. R1-R4 are reported per month, R3 and R5 per calendar year.
 * An indicator whose threshold setting is unset, or whose data is missing, is listed under `omitted`
 * with the reason instead of being computed from an assumed value.
 */
export function computeReports(facts: ComplianceFacts, config: ComplianceConfigInput, options: ComputeOptions = {}): ComplianceReports {
  const ctx = buildContext(facts, config, options)
  return {
    methodVersion: METHOD_VERSION,
    months: ctx.months,
    years: ctx.years,
    reports: [
      ...ctx.months.map((month) => computeR1(ctx, month)),
      ...ctx.months.map((month) => computeR2(ctx, month)),
      ...ctx.months.map((month) => computeR3Month(ctx, month)),
      ...ctx.years.map((year) => computeR3Year(ctx, year)),
      ...ctx.months.map((month) => computeR4(ctx, month)),
      ...ctx.years.map((year) => computeR5(ctx, year)),
    ],
  }
}
