// pay.flat (every period) and pay.one_time (once per position ever, TS-25) to each eligible earner.
import { toRaw } from '../money.js'
import type { BonusOf, Done, PayoutFn, RunContext } from '../pipeline.js'
import type { RawLine } from '../types.js'
import { laddersOf, noOrderPurpose, payeeOf, payoutLines } from './unilevel.js'

function fixedAmount(rule: BonusOf<'pay.flat' | 'pay.one_time'>, ctx: RunContext, done: Done<'individual'>, skip: (k: number) => boolean): readonly RawLine[] {
  const q = done.qualification
  const payee = payeeOf(ctx, q, rule.eligibleIf)
  const out = payoutLines(ctx, rule, q, { pass: 4, unit: 'currency', tree: null, ladders: laddersOf(rule.eligibleIf?.ladder), purposeRaw: noOrderPurpose })
  const raw = toRaw(rule.amountMinor)
  for (let k = 0; k < ctx.positions.length; k++) {
    if (payee(k) && !skip(k)) out.add(k, { k: -1, level: null, measure: null, ruleKey: null, base: rule.amountMinor, baseScale: 'minor', rate: null, raw })
  }
  return out.lines()
}

export const flat: PayoutFn<'pay.flat'> = (rule, ctx, done) => fixedAmount(rule, ctx, done, () => false)

/** Skips positions whose prior state (after pass-0 transitions) already holds the once-only key. */
export const oneTime: PayoutFn<'pay.one_time'> = (rule, ctx, done) =>
  fixedAmount(rule, ctx, done, (k) => done.transition.prior[k]?.oneTimeFlags.includes(rule.onceKey) ?? false)
