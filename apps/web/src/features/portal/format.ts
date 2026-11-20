// Distributor-facing words (second person, factual: no projections, targets or rankings; BR-HON-01) from the catalogue
// of the effective locale, and formatting per locale (D-BM-11): money from decimal strings with Intl formatToParts
// (never a float), dates with Intl.DateTimeFormat(locale, { timeZone: market zone }). The locale is always passed in
// (server rendering has no browser locale).
import type { StepUpWords } from '../../components/step-up-modal'
import { minorToDecimal } from '../../lib/format'
import type { Locale, Translate } from './i18n'
import { knownMessage } from './i18n/translate'
import type { Blocker, DisputeState, LadderRank, Notice, OriginKind, PayoutState, PrivacyRequest, PrivacyType } from './types'

const NO_BREAK_SPACE = '\u00a0'

const isOneOf = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value)

/** The digits of a currency's minor unit (ISO 4217, as Intl knows them): EUR 2, JPY 0. */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
}

/**
 * "52,00 €" (de) / "€52.00" (en) from minor units: the integer part is grouped by Intl from a BigInt and the fraction
 * digits are copied, so no amount passes through a float. `signed` shows "+" on positive amounts.
 */
export function formatMoney(minor: string, currency: string, minorUnit: number, locale: Locale, signed = false): string {
  const negative = minor.startsWith('-')
  const digits = minor.replace(/^[-+]/, '').padStart(minorUnit + 1, '0')
  const fraction = minorUnit === 0 ? '' : digits.slice(-minorUnit)
  const integer = new Intl.NumberFormat(locale).format(BigInt(digits.slice(0, digits.length - minorUnit)))
  const sample = /^0+$/.test(digits) ? 0 : negative ? -1 : 1
  const parts = new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: minorUnit, maximumFractionDigits: minorUnit, signDisplay: signed ? 'exceptZero' : 'auto',
  }).formatToParts(sample)
  return parts.map((part) => (part.type === 'integer' ? integer : part.type === 'fraction' ? fraction : part.value)).join('')
}

const DECIMAL_TEXT = /^(-?)(\d+)(?:\.(\d+))?$/

/** A decimal string ("1234.5") with the locale's grouping and separator ("1.234,5"); other text as given. */
export function formatDecimal(value: string, locale: Locale): string {
  const match = DECIMAL_TEXT.exec(value)
  if (match === null) return value
  const [, sign = '', whole = '0', fraction] = match
  const separator = new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')?.value ?? '.'
  return `${sign}${new Intl.NumberFormat(locale).format(BigInt(whole))}${fraction === undefined ? '' : `${separator}${fraction}`}`
}

/** A decimal money amount ("8.00", "-0.125") in the currency's style with its own fraction digits: "8,00 €" (de), "€8.00" (en). */
export function formatDecimalMoney(value: string, currency: string, locale: Locale): string {
  const match = DECIMAL_TEXT.exec(value)
  if (match === null) return value
  const [, sign = '', whole = '0', fraction = ''] = match
  return formatMoney(`${sign}${whole}${fraction}`, currency, fraction.length, locale)
}

/** A rate as a percentage string by an exact decimal shift ("0.020000" -> "2", "0.125" -> "12.5"); null for other text. */
function percentDigits(rate: string): string | null {
  const match = DECIMAL_TEXT.exec(rate)
  if (match === null) return null
  const [, sign, whole, fraction = ''] = match
  const digits = fraction.padEnd(2, '0')
  const integer = `${whole}${digits.slice(0, 2)}`.replace(/^0+(?=\d)/, '')
  const rest = digits.slice(2).replace(/0+$/, '')
  return `${sign}${integer}${rest === '' ? '' : `.${rest}`}`
}

/** "2 %" (en) / "2,5 %" (de) from a rate string; other words ("rates vary") as given. */
export function percentText(rate: string, locale: Locale): string {
  const digits = percentDigits(rate)
  return digits === null ? rate : `${formatDecimal(digits, locale)}${NO_BREAK_SPACE}%`
}

/** An explanation rate as "rate 8 %" (English; staff SC-12 drops the prefix). */
export function rateText(rate: string): string {
  const digits = percentDigits(rate)
  return digits === null ? rate : `rate ${digits} %`
}

/** "2026-08-01": the day of an instant in the participant's market zone (file names). */
export function isoDay(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(new Date(value))
}

/** Formatting and words of one locale in the participant's market zone. */
export interface L10n {
  readonly locale: Locale
  readonly t: Translate
  readonly zone: string
  /** Money of a market or statement (currency and minor unit); "—" for null. */
  readonly money: (minor: string | null, market: { readonly currency: string; readonly minor_unit: number }, signed?: boolean) => string
  /** "21.11.2026" (de) / "Nov 21, 2026" (en): the day of an instant in the market zone. */
  readonly day: (instant: string) => string
  /** The day and time of an instant in the market zone. */
  readonly time: (instant: string) => string
  /** A calendar date (YYYY-MM-DD) as given, never shifted by a zone. */
  readonly date: (date: string) => string
  /** A period's first and last day in the market zone (ends_at is exclusive). */
  readonly period: (startsAt: string, endsAt: string) => string
  readonly decimal: (value: string) => string
  /** A decimal money amount of an explanation in the currency's style ("8,00 €"). */
  readonly decimalMoney: (value: string, currency: string) => string
  /** Volumes are minor units of the participant's market (rate × volume = money minor, BUG-087). */
  readonly volume: (minor: string, minorUnit: number) => string
  readonly percent: (rate: string) => string
}

export function l10n(locale: Locale, zone: string, t: Translate): L10n {
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: zone })
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone })
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  return {
    locale, t, zone,
    money: (minor, market, signed = false) => (minor === null ? '—' : formatMoney(minor, market.currency, market.minor_unit, locale, signed)),
    day: (instant) => day.format(new Date(instant)),
    time: (instant) => time.format(new Date(instant)),
    date: (value) => date.format(new Date(`${value}T00:00:00Z`)),
    period: (startsAt, endsAt) => {
      const first = day.format(new Date(startsAt))
      const last = day.format(new Date(new Date(endsAt).getTime() - 1))
      return first === last ? first : `${first} – ${last}`
    },
    decimal: (value) => formatDecimal(value, locale),
    decimalMoney: (value, currency) => formatDecimalMoney(value, currency, locale),
    volume: (minor, minorUnit) => formatDecimal(minorToDecimal(minor, minorUnit), locale),
    percent: (rate) => percentText(rate, locale),
  }
}

export interface Badge {
  readonly label: string
  readonly state: string
}

const PAYOUT_BADGE: Readonly<Record<PayoutState, string>> = {
  none: 'open', in_transit: 'pending', settled: 'settled', returned: 'returned', failed: 'failed', mixed: 'open',
}

/** A statement's payout badge; a net amount of zero or less is never "not paid out yet": nothing is due (BUG-114). */
export function payoutState(state: PayoutState, netMinor: string | null, t: Translate): Badge {
  if (state === 'none' && BigInt(netMinor ?? '0') <= 0n) return { label: t('payout.no_payout_due'), state: 'closed' }
  return { label: t(`payout.state.${state}`), state: PAYOUT_BADGE[state] }
}

/** Instruction states (pending/instructed/accepted are on their way). */
export function instructionLabel(state: string, t: Translate): string {
  if (state === 'settled') return t('payout.instruction.settled')
  if (state === 'returned') return t('payout.instruction.returned')
  if (state === 'failed' || state === 'cancelled') return t('payout.instruction.failed')
  return t('payout.instruction.on_its_way')
}

const BLOCKERS = ['hold', 'no_bank_details', 'tax_profile_missing', 'returned_payment_open'] as const

/** Why a payout skips you (pay_payee_blockers codes; never a hold's staff-written text, D-B5-07). */
export function blockerText(blocker: Blocker, words: L10n): string {
  const { t } = words
  if (blocker.reason === 'bank_detail_cooling_off') {
    return blocker.until === undefined ? t('blocker.cooling_off') : t('blocker.cooling_off_until', { until: words.time(blocker.until) })
  }
  return isOneOf(BLOCKERS, blocker.reason) ? t(`blocker.${blocker.reason}`) : t('blocker.other')
}

export function originText(kind: OriginKind, t: Translate): string | null {
  return kind === 'none' ? null : t(`origin.${kind}`)
}

const DISPUTE_BADGE: Readonly<Record<DisputeState, string>> = {
  opened: 'requested', under_review: 'under_review', upheld: 'accepted', not_upheld: 'ended',
}

export function disputeBadge(state: DisputeState, t: Translate): Badge {
  return { label: t(`dispute.state.${state}`), state: DISPUTE_BADGE[state] }
}

// shortcut: plan rules carry no distributor-facing name, so rule, ladder and measure keys are shown as words (common
// volume abbreviations spelled out); use the plan's display names once rules have them (BUG-119).
// 'capped' agrees with Volumen (neuter) in German: "gedeckeltes persönliches Volumen" (BUG-138).
const KEY_WORDS = ['pv', 'gv', 'bv', 'cv', 'qv', 'ov', 'capped'] as const

/** "unilevel" -> "Unilevel", "capped_pv" -> "Capped personal volume" (plan data is not translated, the volume words are). */
export function keyLabel(key: string, t: Translate): string {
  const words = key.split('_').filter((word) => word !== '').map((word) => (isOneOf(KEY_WORDS, word) ? t(`keyword.${word}`) : word)).join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "gold" or "Main: gold · Leadership: silver" per ladder; "No rank" when none. */
export function rankText(ranks: readonly LadderRank[], t: Translate): string {
  const held = ranks.filter((r) => r.rank !== null)
  if (held.length === 0) return t('rank.no_rank')
  return held.map((r) => (ranks.length > 1 ? `${keyLabel(r.ladder, t)}: ${r.rank}` : r.rank)).join(' · ')
}

/** "Paid as gold", or "No paid-as rank" (never "Paid as No rank", BUG-119). */
export function paidAsText(ranks: readonly LadderRank[], t: Translate): string {
  return ranks.some((r) => r.rank !== null) ? t('rank.paid_as_value', { rank: rankText(ranks, t) }) : t('rank.no_paid_as')
}

/** A rank requirement (texts in the effective locale from comp/rank.ts) with its measure key in words. */
export function requirementText(item: { readonly kind: string; readonly text: string; readonly measure?: string }, t: Translate): string {
  return item.kind === 'measure' && item.measure !== undefined && item.text.startsWith(`${item.measure} `)
    ? `${keyLabel(item.measure, t)}${item.text.slice(item.measure.length)}`
    : item.text
}

/**
 * The statement's withholding row label: "Withholding (2 %)" with the rule's rate, "Withholding" without a duty (no rate
 * applies, BUG-138), "Withheld" without a rule.
 */
export function withholdingLabel(withholding: { readonly rate: string; readonly rate_basis: string } | null, words: L10n): string {
  if (withholding === null) return words.t('statement.withheld')
  if (withholding.rate_basis === 'no_duty') return words.t('statement.withholding_no_rate')
  return words.t('statement.withholding', { rate: words.percent(withholding.rate) })
}

const BASIS_NOTES = ['missing_id_rate', 'below_threshold', 'no_duty'] as const

/** Why the rate applies (tax_line.rate_basis): below threshold, no tax id: higher rate, no withholding duty; none for 'rate'. */
export function withholdingNote(rateBasis: string, t: Translate): string | null {
  return isOneOf(BASIS_NOTES, rateBasis) ? t(`statement.basis.${rateBasis}`) : null
}

export const PRIVACY_TYPES: readonly PrivacyType[] = ['access', 'portability', 'correction', 'erasure']

const PRIVACY_BADGE: Readonly<Record<PrivacyRequest['state'], string>> = {
  received: 'open', in_progress: 'in_review', fulfilled: 'closed', refused: 'rejected',
}

export function privacyBadge(state: PrivacyRequest['state'], t: Translate): Badge {
  return { label: t(`privacy.state.${state}`), state: PRIVACY_BADGE[state] }
}

const DEFERRALS = ['open_payable', 'payout_in_flight', 'payout_hold', 'open_case'] as const

/** Why an erasure waits (prv_erasure_blockers codes). */
export function deferralText(reason: string, t: Translate): string {
  return isOneOf(DEFERRALS, reason) ? t(`privacy.deferral.${reason}`) : t('privacy.deferral.other')
}

/** The sentence for a failed request by its error code (never the API message, D-BM-11); `params` fill its placeholders. */
export function errorText(error: unknown, t: Translate): string {
  const failure = error as { readonly code?: unknown; readonly status?: unknown; readonly details?: unknown; readonly requestId?: unknown } | null
  const code = typeof failure?.code === 'string' ? failure.code : 'unknown'
  const status = typeof failure?.status === 'number' ? failure.status : 0
  if (status >= 500 && code !== 'SERVICE_UNAVAILABLE') {
    return typeof failure?.requestId === 'string' ? t('errors.server_reference', { reference: failure.requestId }) : t('errors.server')
  }
  const label = (failure?.details as { readonly label?: unknown } | null | undefined)?.label
  if (code === 'TAX_ID_FORMAT') return typeof label === 'string' ? t('errors.TAX_ID_FORMAT', { label }) : t('errors.TAX_ID_CHARS')
  return knownMessage(t, `errors.${code}`) ?? t('errors.unknown')
}

/** Codes a re-authentication (password or authenticator code) can fail with; any other is errors.unknown. */
const STEP_UP_FAILURES = ['SIGN_IN_LOCKED', 'RATE_LIMITED', 'MFA_CODE_INVALID', 'NETWORK_ERROR', 'SERVICE_UNAVAILABLE'] as const

/** The shared step-up prompts (components/step-up-modal) in catalogue words: plain strings for the root layout too. */
export function stepUpWords(t: Translate): StepUpWords {
  const errors = Object.fromEntries(STEP_UP_FAILURES.map((code) => [code, errorText({ code }, t)]))
  return {
    passwordTitle: t('reauth.title'),
    passwordText: t('reauth.text'),
    password: t('auth.password'),
    passwordRequired: t('auth.password_required'),
    codeTitle: t('reauth.code_title'),
    codeText: t('reauth.code_text'),
    codeSection: t('reauth.code_section'),
    code: { label: t('reauth.code'), helper: t('reauth.code_helper'), required: t('reauth.code_required'), digits: t('reauth.code_digits') },
    submit: t('reauth.submit'),
    cancel: t('common.cancel'),
    close: t('common.close_dialog'),
    errors: { ...errors, INVALID_CREDENTIALS: t('reauth.password_wrong'), unknown: t('errors.unknown') },
  }
}

export interface NoticeView {
  readonly title: string
  readonly text: string
  readonly href: string | null
  readonly linkLabel: string | null
  /** StatusBadge state (its tone). */
  readonly badge: string
  readonly kind: string
}

type NoticeTemplate = 'statement.ready' | 'payout.sent' | 'payout.held' | 'payout.returned' | 'bank_detail.changed' | 'tax_profile.changed'
  | 'dispute.updated' | 'privacy_request.updated' | 'plan.change_scheduled' | 'tax_form.available'
type NoticeLink = 'statement' | 'statements' | 'payment' | 'disputes' | 'my_data' | 'rank' | 'tax'

const str = (params: Notice['params'], key: string): string | null => (typeof params[key] === 'string' ? params[key] as string : null)

function noticeMoney(params: Notice['params'], key: string, words: L10n): string | null {
  const minor = str(params, key)
  const currency = str(params, 'currency')
  if (minor === null || currency === null) return null
  const unit = typeof params.minor_unit === 'number' ? params.minor_unit : currencyDigits(currency)
  return formatMoney(minor, currency, unit, words.locale)
}

/** An inbox card from the notification's template and params (ids, decimal strings, instants, masked values). */
export function noticeView(notice: Notice, words: L10n): NoticeView {
  const { t } = words
  const p = notice.params
  const card = (template: NoticeTemplate, badge: string, text: string, href: string, link: NoticeLink): NoticeView => ({
    title: t(`notice.${template}.title`), kind: t(`notice.${template}.kind`), badge, text, href, linkLabel: t(`notice.link.${link}`),
  })
  switch (notice.template) {
    case 'statement.ready': {
      const starts = str(p, 'starts_at')
      const ends = str(p, 'ends_at')
      const run = str(p, 'run_id')
      const period = starts === null || ends === null ? t('notice.a_period') : words.period(starts, ends)
      const net = noticeMoney(p, 'net_minor', words)
      const text = `${t('notice.statement.ready.text', { period })}${net === null ? '' : ` ${t('notice.statement.ready.net', { amount: net })}`}`
      return card(notice.template, 'ready', text, run === null ? '/portal/earnings' : `/portal/earnings/${run}`, 'statement')
    }
    case 'payout.sent':
      return card(notice.template, 'ready', t('notice.payout.sent.text', { amount: noticeMoney(p, 'amount_minor', words) ?? t('notice.a_payout'), masked: str(p, 'masked') ?? '' }), '/portal/earnings', 'statements')
    case 'payout.held': {
      const reasons = Array.isArray(p.reasons) ? (p.reasons as Blocker[]).map((r) => blockerText(r, words)) : []
      const text = [t('notice.payout.held.text', { amount: noticeMoney(p, 'amount_minor', words) ?? t('notice.your_payable') }), ...reasons].join(' ')
      return card(notice.template, 'held', text, '/portal/more/payment-details', 'payment')
    }
    case 'payout.returned':
      return card(notice.template, 'held', t('notice.payout.returned.text', { amount: noticeMoney(p, 'amount_minor', words) ?? t('notice.a_payout'), masked: str(p, 'masked') ?? '' }), '/portal/more/payment-details', 'payment')
    case 'bank_detail.changed': {
      const until = str(p, 'cooling_off_until')
      const previous = str(p, 'previous_masked')
      const masked = str(p, 'masked') ?? ''
      const text = [
        previous === null ? t('notice.bank_detail.changed.now', { masked }) : t('notice.bank_detail.changed.from', { previous, masked }),
        ...(until === null ? [] : [t('notice.bank_detail.changed.starts', { until: words.time(until) })]),
        t('notice.bank_detail.changed.warning'),
      ].join(' ')
      return card(notice.template, 'blocked', text, '/portal/more/payment-details', 'payment')
    }
    case 'tax_profile.changed': {
      const from = str(p, 'valid_from')
      const text = `${from === null ? t('notice.tax_profile.changed.text') : t('notice.tax_profile.changed.on', { at: words.time(from) })} ${t('notice.tax_profile.changed.warning')}`
      return card(notice.template, 'blocked', text, '/portal/more/payment-details', 'payment')
    }
    case 'dispute.updated': {
      const outcome = str(p, 'outcome')
      const text = outcome === 'upheld' ? t('notice.dispute.updated.upheld') : outcome === 'not_upheld' ? t('notice.dispute.updated.not_upheld') : t('notice.dispute.updated.text')
      return card(notice.template, 'pending', text, '/portal/earnings#disputes', 'disputes')
    }
    case 'privacy_request.updated': {
      const type = str(p, 'type')
      const outcome = str(p, 'outcome')
      const request = type !== null && isOneOf(PRIVACY_TYPES, type) ? t(`privacy.type.${type}`) : t('notice.your_request')
      const state = outcome === 'fulfilled' ? t('notice.privacy_request.done') : outcome === 'refused' ? t('notice.privacy_request.refused') : t('notice.privacy_request.updated')
      return card(notice.template, 'pending', t('notice.privacy_request.updated.text', { request, state }), '/portal/more/my-data', 'my_data')
    }
    case 'plan.change_scheduled': {
      const from = str(p, 'effective_from')
      const zone = str(p, 'time_zone')
      const at = from === null ? null : (zone === null ? words : l10n(words.locale, zone, t)).time(from)
      return card(notice.template, 'pending', at === null ? t('notice.plan.change_scheduled.soon') : t('notice.plan.change_scheduled.text', { at }), '/portal/rank', 'rank')
    }
    case 'tax_form.available': {
      const year = typeof p.tax_year === 'number' ? p.tax_year : null
      const text = t('notice.tax_form.available.text', { form_type: str(p, 'form_type') ?? '', tax_year: year === null ? '' : String(year) })
      return card(notice.template, 'ready', text, '/portal/more/tax-statements', 'tax')
    }
    default:
      return { title: t('notice.other.title'), kind: t('notice.other.kind'), badge: 'open', text: t('notice.other.text'), href: null, linkLabel: null }
  }
}
