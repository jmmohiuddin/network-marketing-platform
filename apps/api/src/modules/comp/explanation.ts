import { formatUnits, RAW_DECIMALS, toRaw, traceAmountMinor, type Trace, type TraceSource, type TraceStep } from '@nmp/engine'
import type { Texts } from './messages.js'
import type { OriginKind } from './statements.js'

// FR-DIST-002 (D-B5-08): the distributor's explanation of one result line, a pure template over the stored compact
// trace. Sources are aggregated per level: no other position's id, ref or name ever appears (C-B5-15). Texts come from
// the COMP catalogues in the portal's effective locale (D-BM-11, messages.ts).

export interface PeriodDates { readonly starts_at: Date; readonly ends_at: Date }

export interface ExplanationInput {
  readonly line: { readonly id: string; readonly run_id: string; readonly amount_minor: string; readonly currency: string }
  readonly trace: Trace
  readonly rule: { readonly key: string; readonly name: string }
  readonly period: PeriodDates
  readonly timeZone: string // the market's zone: dates in the text are its calendar days (BUG-112)
  readonly origin: { readonly kind: OriginKind; readonly original_period: (PeriodDates & { readonly id: string }) | null } | null
  readonly minorDigits: number
}

export interface Part {
  readonly level: number | null
  readonly label: string
  readonly count: number
  readonly base: string | null
  readonly base_unit: 'money' | 'volume' | null
  readonly rate: string | null
  readonly contribution: string
}

/** Engine bonus kinds with their own opening sentence (explanation.intro.<kind without "pay.">); any other is generic. */
const TEMPLATED: ReadonlySet<string> = new Set([
  'pay.retail_margin', 'pay.percent_by_level', 'pay.generations', 'pay.percent_of_measure', 'pay.differential', 'pay.override',
  'pay.matching', 'pay.fast_start', 'pay.flat', 'pay.one_time', 'pay.pool', 'adjustment',
])

const TRACE_BIGINTS = new Set(['raw', 'base', 'capMinor', 'num', 'den', 'beforeRaw', 'afterRaw', 'afterMinor', 'weight', 'totalMinor', 'minor', 'knownAtUs'])

/** The stored trace (jsonb text, bigints as decimal strings) as the engine's Trace. */
export function traceFromJson(text: string): Trace {
  return JSON.parse(text, (key, value: unknown) => (TRACE_BIGINTS.has(key) && typeof value === 'string' ? BigInt(value) : value)) as Trace
}

/** Raw (minor x 10^12) as a decimal with at least `digits` places and no trailing zeros beyond them. */
export function rawDecimal(raw: bigint, digits: number): string {
  const [whole, fraction = ''] = formatUnits(raw, digits + RAW_DECIMALS, true).split('.')
  return `${whole}.${fraction.padEnd(digits, '0')}`.replace(/\.$/, '')
}

const sourceRaw = (s: TraceSource): bigint => (s.baseScale === 'minor' ? toRaw(s.base) : s.base)

function partOf(sources: readonly TraceSource[], level: number | null, label: string, digits: number): Part {
  const rates = new Set(sources.flatMap((s) => (s.rate === null ? [] : [s.rate])))
  return {
    level, label, count: sources.length,
    base: rawDecimal(sources.reduce((a, s) => a + sourceRaw(s), 0n), digits),
    base_unit: sources.every((s) => s.measure === null) ? 'money' : 'volume',
    rate: rates.size === 0 ? null : rates.size === 1 ? [...rates][0]! : 'rates vary',
    contribution: rawDecimal(sources.reduce((a, s) => a + s.raw, 0n), digits),
  }
}

/** Sources per level; the payee's own position is "your own volume" and the market total its own part (labels in the locale). */
export function partsOf(trace: Trace, digits: number, { t }: Texts): Part[] {
  const own = trace.sources.filter((s) => s.positionId === trace.payeePositionId)
  const market = trace.sources.filter((s) => s.positionId === null)
  const others = trace.sources.filter((s) => s.positionId !== null && s.positionId !== trace.payeePositionId)
  const levels = [...new Set(others.map((s) => s.level))].sort((a, b) => (a ?? -1) - (b ?? -1))
  const word = trace.kind === 'pay.generations' || trace.kind === 'pay.matching' ? 'explanation.label.generation' : 'explanation.label.level'
  return [
    ...(own.length === 0 ? [] : [partOf(own, own[0]!.level, t('explanation.label.own'), digits)]),
    ...levels.map((level) => partOf(others.filter((s) => s.level === level), level, level === null ? t('explanation.label.team') : t(word, { level }), digits)),
    ...(market.length === 0 ? [] : [partOf(market, null, t('explanation.label.market'), digits)]),
    ...(trace.omitted.count === 0 ? [] : [{
      level: null, label: t('explanation.label.omitted', { count: trace.omitted.count }), count: trace.omitted.count, base: null, base_unit: null,
      rate: null, contribution: rawDecimal(trace.omitted.raw, digits),
    }]),
  ]
}

function stepText(step: Exclude<TraceStep, { step: 'rounding' }>, digits: number, { t, decimal }: Texts): string {
  const raw = (r: bigint) => decimal(rawDecimal(r, digits))
  const money = (m: bigint) => decimal(formatUnits(m, digits))
  if (step.step === 'constraint') return t('explanation.step.limit', { key: step.key, before: raw(step.beforeRaw), after: raw(step.afterRaw) })
  if (step.step === 'cap') {
    return t('explanation.step.cap', { key: step.key, method: t(`explanation.cap_method.${step.method}`), before: raw(step.beforeRaw), after: money(step.afterMinor) })
  }
  if (step.step === 'allocation') {
    return t('explanation.step.allocation', { key: step.key, weight: step.weight.toString(), total: money(step.totalMinor), after: money(step.afterMinor) })
  }
  return t('explanation.step.points', { factor: decimal(step.factor), before: raw(step.beforeRaw), after: raw(step.afterRaw) })
}

/** The calendar day (YYYY-MM-DD) of an instant in the market's zone (BUG-112). */
export const marketDay = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)

// shortcut: plan rules carry no distributor-facing name, so a rule is named by its key in words (common volume
// abbreviations spelled out), as the web portal does (BUG-119); use the plan's display names once rules have them.
const KEY_WORDS: Readonly<Record<string, string>> = {
  pv: 'personal volume', gv: 'group volume', bv: 'business volume', cv: 'commissionable volume', qv: 'qualifying volume', ov: 'organisation volume',
}

/** "unilevel" → "Unilevel", "capped_pv" → "Capped personal volume". */
export function ruleName(key: string): string {
  const words = key.split('_').filter((word) => word !== '').map((word) => KEY_WORDS[word] ?? word).join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A rate as a percentage by string arithmetic: "0.08" → "8 %", "0.125" → "12.5 %"; anything else unchanged. */
export function percentText(rate: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(rate)
  if (match === null) return rate
  const [, sign, whole, fraction = ''] = match
  const digits = fraction.padEnd(2, '0')
  const integer = `${whole}${digits.slice(0, 2)}`.replace(/^0+(?=\d)/, '')
  const rest = digits.slice(2).replace(/0+$/, '')
  return `${sign}${integer}${rest === '' ? '' : `.${rest}`} %`
}

export type Explanation = ReturnType<typeof explainLine>

/**
 * The explanation body (API-29) with its texts in the locale of `texts`. `template` is 'generic' for a kind without a
 * template (the caller logs it); `reconciles` = the engine's traceAmountMinor equals the line amount (the caller refuses a mismatch).
 */
export function explainLine(input: ExplanationInput, texts: Texts) {
  const { trace, minorDigits: digits } = input
  const { t, decimal } = texts
  const day = (at: Date): string => texts.day(at, input.timeZone)
  // A period's ends_at is exclusive: the text names the last market day it includes.
  const span = (p: PeriodDates) => ({ from: day(p.starts_at), to: day(new Date(p.ends_at.getTime() - 1)) })
  const template = TEMPLATED.has(trace.kind) ? trace.kind.replace(/^pay\./, '') : 'generic'
  const parts = partsOf(trace, digits, texts)
  const steps = trace.steps.flatMap((s) => (s.step === 'rounding' ? [] : [{ kind: s.step === 'constraint' ? 'limit' : s.step, text: stepText(s, digits, texts) }]))
  const roundingStep = trace.steps.find((s): s is Extract<TraceStep, { step: 'rounding' }> => s.step === 'rounding')
  const rounding = roundingStep === undefined ? null
    : { mode: roundingStep.mode, before: rawDecimal(roundingStep.raw, digits), after: formatUnits(roundingStep.minor, digits) }
  const amount = formatUnits(BigInt(input.line.amount_minor), digits)
  const ranks = trace.rankEvaluated.map((r) => `${r.ladder} ${r.rank ?? t('explanation.rank_none')}`).join(', ')
  const origin = input.origin
  const rateText = (rate: string) => (rate === 'rates vary' ? t('explanation.rates_vary') : decimal(percentText(rate)))
  const text = [
    template === 'generic' ? t('explanation.intro.generic', { kind: trace.kind }) : t(`explanation.intro.${template}`),
    t('explanation.rule', { name: input.rule.name }),
    ...(ranks === '' ? [] : [t('explanation.rank_used', { ranks })]),
    t('explanation.period', span(input.period)),
    ...parts.map((p) => t('explanation.part', {
      label: p.label, sources: t('explanation.sources', { count: p.count }),
      base: p.base === null ? '' : t('explanation.part_base', { base: decimal(p.base) }),
      rate: p.rate === null ? '' : t('explanation.part_rate', { rate: rateText(p.rate) }),
      contribution: decimal(p.contribution),
    })),
    ...steps.map((s) => s.text),
    ...(rounding === null ? [] : [t('explanation.rounded', { mode: t(`explanation.rounding.${rounding.mode}`), before: decimal(rounding.before), after: decimal(rounding.after) })]),
    ...(origin === null ? [] : [origin.original_period === null
      ? t('explanation.origin', { kind: t(`explanation.origin_kind.${origin.kind}`) })
      : t('explanation.origin_of', { kind: t(`explanation.origin_kind.${origin.kind}`), ...span(origin.original_period) })]),
    t('explanation.amount', { amount: decimal(amount), currency: input.line.currency }),
  ]
  return {
    line_id: input.line.id, run_id: input.line.run_id, template,
    rule: { key: input.rule.key, name: input.rule.name, kind: trace.kind },
    period: { starts_at: input.period.starts_at, ends_at: input.period.ends_at },
    amount_minor: input.line.amount_minor, currency: input.line.currency, rank_used: trace.rankEvaluated, parts, steps, rounding, origin, text,
    reconciles: traceAmountMinor(trace) === BigInt(input.line.amount_minor),
  }
}
