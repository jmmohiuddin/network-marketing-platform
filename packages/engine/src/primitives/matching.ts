// pay.matching (pass 5): rates[g-1] x the pass-4 lines named in `of` of positions g generations below (TS-44).
import { EngineError } from '../errors.js'
import { mulRate, parseDecimal } from '../money.js'
import { BONUS_PASS, type PayoutFn } from '../pipeline.js'
import type { RawLine } from '../types.js'
import { laddersOf, payeeOf, payoutLines } from './unilevel.js'

/**
 * The base is the matched line's unrounded raw (before caps), so matching rounds once with its own line.
 * Lines with raw <= 0 are reversals and are never matched (TR-ENG-16). Matched lines are aggregates and cite no
 * orders (TS-10: order-line clawback of a match is 0.00); their purpose split is the matched line's, scaled.
 */
export const matching: PayoutFn<'pay.matching', 'matching'> = (rule, ctx, done) => {
  for (const key of rule.of) {
    const matched = ctx.input.plan.bonuses.find((b) => b.key === key)
    if (matched === undefined || BONUS_PASS[matched.kind] !== 'individual') throw new EngineError('INVALID_INPUT', 'matching must name pass-4 bonuses', { rule: rule.key, of: key })
  }
  const q = done.qualification
  const tree = ctx.trees[rule.tree]
  const payee = payeeOf(ctx, q, rule.eligibleIf)
  const rates = rule.rates.map(parseDecimal)
  const lines = done.individual.filter((l) => rule.of.includes(l.ruleKey) && l.raw > 0n)
  const unit = lines[0]?.unit ?? 'currency'
  if (lines.some((l) => l.unit !== unit)) throw new EngineError('INVALID_INPUT', 'matching mixes currency and points lines', { rule: rule.key })
  const matched = new Map<string, RawLine>(lines.map((l) => [JSON.stringify([l.payeePositionId, l.ruleKey]), l]))
  const purposeRaw = (c: { readonly k: number; readonly ruleKey: string | null; readonly raw: bigint }, p: string): bigint => {
    const line = matched.get(JSON.stringify([tree.ids[c.k], c.ruleKey]))!
    return (c.raw * (line.purposeRaw.find((x) => x.purpose === p)?.raw ?? 0n)) / line.raw
  }
  const out = payoutLines(ctx, rule, q, { pass: 5, unit, tree: rule.tree, ladders: laddersOf(rule.eligibleIf?.ladder), purposeRaw })

  for (const line of lines) {
    const k = tree.index.get(line.payeePositionId)
    if (k === undefined) throw new EngineError('INVALID_INPUT', 'matched line names an unknown position', { positionId: line.payeePositionId })
    let a = tree.parent[k]!
    for (let g = 1; g <= rates.length && a >= 0; g++, a = tree.parent[a]!) {
      if (payee(a)) out.add(a, { k, level: g, measure: null, ruleKey: line.ruleKey, base: line.raw, baseScale: 'raw', rate: rule.rates[g - 1]!, raw: mulRate(line.raw, rates[g - 1]!), orders: [] })
    }
  }
  return out.lines()
}
