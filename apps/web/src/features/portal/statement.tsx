import Link from 'next/link'
import type { ReactNode } from 'react'
import { LinkButton } from '../../components/button'
import { Icon } from '../../components/icon'
import { StatusBadge } from '../../components/status-badge'
import { ApiError } from '../../lib/api'
import { CAPTION, CARD, Failure, linePath, MONO, PAGE_TITLE, Section, statementPath, TEXT_LINK, TILE } from './blocks'
import {
  blockerText, disputeBadge, formatMoney, instructionLabel, isoDay, keyLabel, originText, paidAsText, rankText, withholdingLabel,
  withholdingNote, type L10n,
} from './format'
import { portalSession, serverGet, settle } from './i18n/server'
import { ExplanationFrame } from './statement-sheet'
import type { Dispute, DisputeState, Explanation, PortalProfile, Statement } from './types'
import { DownloadLink } from './download-link'

// SC-18 statement detail (sc_18), server-rendered so its core reads without scripts (D-BM-12, T-BM-35): status, net as
// the largest element, the reconciliation (D-B5-07 labels, withholding with its rate and basis), lines per position
// and bonus, payout status with blockers in words, CSV download link; a line's explanation (route …/lines/<lineId>)
// renders beside it and becomes a bottom sheet on phones once scripts run.

// shortcut: the newest 50 disputes mark their lines; page through GET /v1/me/disputes when someone has more.
const DISPUTES_READ = 50
/** A decided dispute no longer blocks a new one (409 DISPUTE_OPEN only while one is open, D-B5-15). */
const DECIDED: ReadonlySet<DisputeState> = new Set(['upheld', 'not_upheld'])

export async function StatementPage({ runId, lineId }: { readonly runId: string; readonly lineId?: string }) {
  const session = await portalSession()
  if (session instanceof ApiError) return null
  const { profile, words } = session
  const { t } = words
  const [statement, disputes, explanation] = await Promise.all([
    settle(serverGet<Statement>(`/v1/me/statements/${runId}`)),
    settle(serverGet<Dispute[]>('/v1/me/disputes', { limit: DISPUTES_READ })),
    lineId === undefined ? null : settle(serverGet<Explanation>(`/v1/me/statement-lines/${lineId}/explanation`)),
  ])
  const retryHref = lineId === undefined ? statementPath(runId) : linePath(runId, lineId)
  const retry = <LinkButton href={retryHref}>{t('common.try_again')}</LinkButton>
  if (statement instanceof ApiError) return <Failure error={statement} t={t} retry={retry} />
  // The latest dispute of each line (the list is newest first).
  const byLine = new Map<string, Dispute>()
  if (!(disputes instanceof ApiError)) for (const dispute of disputes.data) if (!byLine.has(dispute.line_id)) byLine.set(dispute.line_id, dispute)
  const failure = disputes instanceof ApiError
    ? <Failure error={disputes} t={t} section retry={retry} />
    : null
  // The failure shows once: in the open explanation (where the dispute link would be), else above the lines.
  const body = <StatementBody statement={statement.data} profile={profile} disputes={byLine} notice={lineId === undefined ? failure : null} words={words} />
  if (lineId === undefined || explanation === null) return body
  return (
    <div className="flex flex-col gap-space-md lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-space-lg lg:items-start">
      <div className="flex flex-col gap-space-md min-w-0">{body}</div>
      <ExplanationFrame title={t('explanation.title')} closeLabel={t('explanation.close')} closeHref={statementPath(runId)}>
        {explanation instanceof ApiError
          ? <Failure error={explanation} t={t} section retry={retry} />
          : <LineExplanation explanation={explanation.data} statement={statement.data} profile={profile} words={words}
            dispute={disputes instanceof ApiError ? undefined : byLine.get(lineId) ?? null} failure={failure} />}
      </ExplanationFrame>
    </div>
  )
}

function StatementBody({ statement, profile, disputes, notice, words }: {
  readonly statement: Statement
  readonly profile: PortalProfile
  readonly disputes: ReadonlyMap<string, Dispute>
  readonly notice: ReactNode
  readonly words: L10n
}) {
  const { t } = words
  const period = words.period(statement.period.starts_at, statement.period.ends_at)
  const refs = statement.positions.map((position) => position.position_ref).join(', ')
  return (
    <>
      <div className="flex items-start justify-between gap-space-sm flex-wrap">
        <div className="min-w-0">
          <h1 className={`${PAGE_TITLE} break-words`}>{t('statement.title', { period })}</h1>
          <p className={CAPTION}>{profile.display_name ?? ''}{refs === '' ? '' : ' · '}<span className={`${MONO} font-semibold`}>{refs}</span></p>
        </div>
        {/* The file is named after the period's first day in the market zone (BUG-112), not the API's UTC day. */}
        <DownloadLink href={`/v1/me/statements/${statement.run_id}/download`} name={`statement-${isoDay(statement.period.starts_at, words.zone)}.csv`} label={t('statement.download')} />
      </div>
      <div className={`${CARD} p-space-sm flex items-center justify-between gap-space-sm flex-wrap`}>
        <div className="flex flex-col">
          <span className="font-caption text-caption uppercase tracking-wider text-tertiary font-semibold">{t('statement.committed')}</span>
          <span className={`${MONO} text-on-surface-variant`}>{words.time(statement.committed_at)}</span>
        </div>
        <StatusBadge state="committed" label={t('statement.final')} />
      </div>
      <NetHero statement={statement} words={words} />
      <Reconciliation statement={statement} words={words} />
      {notice}
      <Lines statement={statement} disputes={disputes} words={words} />
    </>
  )
}

function NetHero({ statement, words }: { readonly statement: Statement; readonly words: L10n }) {
  const { t } = words
  const { instructions, blockers } = statement.payout
  return (
    <section aria-labelledby="net-title" data-testid="card" className={`${CARD} flex flex-col gap-1`}>
      <h2 id="net-title" className="font-caption text-caption uppercase tracking-wider text-on-surface-variant font-medium">{t('statement.net')}</h2>
      <p className="font-display text-display text-on-surface tracking-tight font-semibold break-words">{words.money(statement.summary.net_minor, statement.market)}</p>
      {(instructions.length > 0 || blockers.length > 0) && (
        <div className={`mt-space-sm ${TILE} flex flex-col gap-1.5`}>
          {instructions.map((instruction, index) => (
            <div key={index} className="flex items-center justify-between gap-space-sm flex-wrap">
              <span className="flex items-center gap-2 font-body-lg text-body-lg text-on-surface">
                <Icon name="account_balance" size={18} className="text-primary" />
                {t('statement.paid_to', { amount: words.money(instruction.amount_minor, statement.market), masked: instruction.masked })}
              </span>
              <span className={`${MONO} text-on-surface-variant`}>
                {instructionLabel(instruction.state, t)}{instruction.terminal_at === null ? '' : ` · ${words.time(instruction.terminal_at)}`}
              </span>
            </div>
          ))}
          {blockers.map((blocker) => <p key={blocker.reason} className="font-body-lg text-body-lg text-on-surface-variant">{blockerText(blocker, words)}</p>)}
        </div>
      )}
      {instructions.length === 0 && blockers.length === 0 && (
        <p className={CAPTION}>{BigInt(statement.summary.net_minor) > 0n ? t('statement.no_payout_yet') : t('statement.no_payout_due')}</p>
      )}
    </section>
  )
}

/** gross − withheld − clawback + adjustments = net (D-B5-07); every amount as it enters the sum; withholding with its rate. */
function Reconciliation({ statement, words }: { readonly statement: Statement; readonly words: L10n }) {
  const { t } = words
  const { summary, market } = statement
  const clawback = BigInt(summary.clawback_minor)
  const negate = (minor: string) => (-BigInt(minor)).toString()
  const signed = (minor: string) => words.money(minor, market, true)
  const note = summary.withholding === null ? null : withholdingNote(summary.withholding.rate_basis, t)
  return (
    <Section title={t('statement.adds_up')} icon="balance" testId="reconciliation" aside={<span className={CAPTION}>{t('statement.formula')}</span>}>
      <dl className="flex flex-col gap-2">
        <Row label={t('statement.gross')} value={words.money(summary.gross_minor, market)} />
        <Row label={t('statement.adjustments')} value={signed(summary.adjustment_minor)} />
        <Row label={withholdingLabel(summary.withholding, words)} value={signed(negate(summary.withheld_minor))} note={note} testId="withholding" />
        {clawback > 0n && <Row label={t('statement.recovered')} value={signed(negate(summary.clawback_minor))} />}
        {clawback < 0n && <Row label={t('statement.carried')} value={signed(negate(summary.clawback_minor))} />}
      </dl>
      <div className="flex items-center justify-between gap-space-sm flex-wrap bg-primary-container p-space-sm rounded-lg text-on-primary">
        <span className="font-caption text-caption tracking-wider uppercase">{t('statement.net')}</span>
        <span className="font-data-mono-lg text-data-mono-lg font-bold">{words.money(summary.net_minor, market)}</span>
      </div>
    </Section>
  )
}

function Row({ label, value, note = null, testId }: { readonly label: string; readonly value: string; readonly note?: string | null; readonly testId?: string }) {
  return (
    <div data-testid={testId} className="flex items-center justify-between gap-space-sm flex-wrap py-1.5 px-2 rounded bg-surface-container-low/40">
      <dt className="flex flex-col font-body-lg text-body-lg text-on-surface min-w-0">
        {label}
        {note !== null && <span className={CAPTION}>{note}</span>}
      </dt>
      <dd className="font-data-mono-md text-data-mono-md font-semibold text-on-surface">{value}</dd>
    </div>
  )
}

/** Lines per position (one position: no grouping level) and bonus, each with "How calculated". */
function Lines({ statement, disputes, words }: { readonly statement: Statement; readonly disputes: ReadonlyMap<string, Dispute>; readonly words: L10n }) {
  const { t } = words
  const single = statement.positions.length === 1
  const money = (minor: string) => words.money(minor, statement.market)
  return (
    <>
      {statement.positions.map((position) => (
        <Section key={position.position_id} title={single ? t('statement.your_earnings') : t('statement.earnings_of', { ref: position.position_ref })} icon="receipt_long"
          aside={<span className={CAPTION}>{paidAsText(position.paid_as, t)}</span>}>
          <ul className="flex flex-col gap-2.5">
            {position.bonuses.map((bonus) => (
              <li key={bonus.rule_key} className={`${TILE} flex flex-col gap-1`}>
                <div className="flex items-center justify-between gap-space-sm flex-wrap">
                  <span className="font-body-lg text-body-lg font-medium text-on-surface">{keyLabel(bonus.rule_key, t)}</span>
                  <span className="font-data-mono-md text-data-mono-md font-bold text-on-surface">{money(bonus.total_minor)}</span>
                </div>
                <ul className="flex flex-col">
                  {bonus.lines.map((line) => {
                    const origin = originText(line.origin_kind, t)
                    const dispute = disputes.get(line.id)
                    const badge = dispute === undefined ? null : disputeBadge(dispute.state, t)
                    return (
                      <li key={line.id} className="flex items-center justify-between gap-space-sm flex-wrap border-t border-surface-container first:border-t-0">
                        <span className="flex items-center gap-space-xs flex-wrap">
                          <span className={`${MONO} text-on-surface`}>{money(line.amount_minor)}</span>
                          {origin !== null && <span className={CAPTION}>{line.original_period_id === null ? origin : t('statement.origin_earlier', { origin })}</span>}
                          {badge !== null && <StatusBadge state={badge.state} label={badge.label} />}
                        </span>
                        <Link href={linePath(statement.run_id, line.id)} prefetch={false} className={TEXT_LINK}
                          aria-label={t('statement.how_calculated_of', { rule: keyLabel(bonus.rule_key, t), amount: money(line.amount_minor) })}>
                          {t('statement.how_calculated')} <Icon name="info" size={14} />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {!single && (
            <div className="flex items-center justify-between gap-space-sm flex-wrap font-body-lg text-body-lg">
              <span>{t('statement.total_of', { ref: position.position_ref })}</span>
              <span className="font-data-mono-md text-data-mono-md font-bold">{money(position.total_minor)}</span>
            </div>
          )}
        </Section>
      ))}
      {!single && statement.positions.length > 0 && (
        <div className={`${CARD} flex items-center justify-between gap-space-sm flex-wrap font-body-lg text-body-lg`}>
          <span>{t('statement.total_all')}</span>
          <span className="font-data-mono-md text-data-mono-md font-bold">{money(statement.person_total_minor)}</span>
        </div>
      )}
    </>
  )
}

/** API-29 explanation: sources aggregated per level (no other person named), steps, rounding, origin; dispute state. */
function LineExplanation({ explanation: data, statement, profile, dispute, failure, words }: {
  readonly explanation: Explanation
  readonly statement: Statement
  readonly profile: PortalProfile
  /** The line's latest dispute; null when it has none, undefined when the dispute states could not be loaded. */
  readonly dispute: Dispute | null | undefined
  /** Shown in place of the dispute link when the dispute states could not be loaded. */
  readonly failure: ReactNode
  readonly words: L10n
}) {
  const { t, locale } = words
  const minorUnit = statement.market.minor_unit
  const baseText = (part: Explanation['parts'][number], base: string) => (part.base_unit === 'money'
    ? words.decimalMoney(base, data.currency)
    : `${words.decimal(base)}${part.base_unit === 'volume' ? ` ${t('explanation.volume')}` : ''}`)
  const badge = dispute == null ? null : disputeBadge(dispute.state, t)
  return (
    <div className="flex flex-col gap-space-md">
      <div>
        <span className="font-caption text-caption uppercase tracking-wider text-primary font-semibold">{t('explanation.heading')}</span>
        <h2 className="font-title-md text-title-md text-on-surface">{keyLabel(data.rule.key, t)}</h2>
        {data.text[0] !== undefined && <p className="font-body-lg text-body-lg text-on-surface-variant">{data.text[0]}</p>}
        <p className="font-data-mono-md text-data-mono-md text-on-surface">{formatMoney(data.amount_minor, data.currency, minorUnit, locale)}</p>
      </div>
      <dl className={`${TILE} flex flex-col gap-1.5`}>
        <Fact label={t('explanation.period')}>{words.period(data.period.starts_at, data.period.ends_at)}</Fact>
        {data.rank_used.length > 0 && <Fact label={t('explanation.rank_used')}>{rankText(data.rank_used, t)}</Fact>}
        {data.origin !== null && (
          <Fact label={t('explanation.origin')}>
            {data.origin.original_period === null
              ? originText(data.origin.kind, t) ?? t('explanation.current_period')
              : t('explanation.origin_of', {
                origin: originText(data.origin.kind, t) ?? t('explanation.current_period'),
                period: words.period(data.origin.original_period.starts_at, data.origin.original_period.ends_at),
              })}
          </Fact>
        )}
      </dl>
      {data.parts.length > 0 && (
        <section aria-labelledby="sources-title" className="flex flex-col gap-1.5">
          <h3 id="sources-title" className="font-caption text-caption font-semibold text-on-surface uppercase tracking-wider">{t('explanation.sources')}</h3>
          <ul className="flex flex-col gap-1.5">
            {data.parts.map((part) => (
              <li key={`${part.level ?? 'x'}-${part.label}`} className="flex items-start justify-between gap-space-sm py-1 px-2 rounded bg-surface-container-low">
                <span className="flex flex-col min-w-0">
                  <span className="font-body-lg text-body-lg text-on-surface">{part.label.charAt(0).toUpperCase() + part.label.slice(1)}</span>
                  <span className={CAPTION}>
                    {[
                      t('explanation.source_count', { count: part.count }),
                      ...(part.base === null ? [] : [t('explanation.base', { base: baseText(part, part.base) })]),
                      ...(part.rate === null ? [] : [t('explanation.rate', { rate: words.percent(part.rate) })]),
                    ].join(' · ')}
                  </span>
                </span>
                <span className={`${MONO} text-on-surface font-semibold whitespace-nowrap`}>{words.decimalMoney(part.contribution, data.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(data.steps.length > 0 || data.rounding !== null) && (
        <section aria-labelledby="steps-title" className="flex flex-col gap-1.5">
          <h3 id="steps-title" className="font-caption text-caption font-semibold text-on-surface uppercase tracking-wider">{t('explanation.steps')}</h3>
          <ol className={`${TILE} flex flex-col gap-1 font-body-lg text-body-lg text-on-surface-variant list-decimal pl-8`}>
            {data.steps.map((step, index) => <li key={index}>{step.text}</li>)}
            {data.rounding !== null && (
              <li>{t('explanation.rounded', {
                mode: data.rounding.mode === 'half_even' ? t('explanation.half_even') : t('explanation.half_up'),
                before: words.decimal(data.rounding.before), after: words.decimal(data.rounding.after),
              })}</li>
            )}
          </ol>
        </section>
      )}
      {dispute != null && badge !== null && (
        <div className={`${TILE} flex flex-col gap-1`}>
          <StatusBadge state={badge.state} label={badge.label} />
          {dispute.explanation !== null && <p className="font-body-lg text-body-lg text-on-surface">{dispute.explanation}</p>}
          {dispute.explanation === null && <p className={CAPTION}>{dispute.due_at === null ? t('explanation.no_response_time') : t('explanation.answer_due', { at: words.time(dispute.due_at) })}</p>}
        </div>
      )}
      {dispute === undefined && failure}
      {dispute !== undefined && !profile.terminated && (dispute === null || DECIDED.has(dispute.state)) && (
        <LinkButton href={`${linePath(statement.run_id, data.line_id)}/dispute`} variant="destructive" size="lg" icon="flag">{t('dispute.title')}</LinkButton>
      )}
    </div>
  )
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex justify-between gap-space-sm">
      <dt className={CAPTION}>{label}</dt>
      <dd className="font-body-lg text-body-lg text-on-surface text-right">{children}</dd>
    </div>
  )
}
