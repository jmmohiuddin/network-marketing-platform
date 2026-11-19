'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Button, FOCUS_RING, LinkButton } from '../../components/button'
import { Icon } from '../../components/icon'
import { useModalDialog } from '../../components/modal'
import { ErrorState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { decimal } from '../data/format'
import { saveFile } from '../data/transfer'
import { moneyText } from '../orders/format'
import { marketMoney, periodName, signedMoney } from '../periods/format'
import { blockerText, DISPUTE_STATE, instructionLabel, isoDay, keyLabel, originText, paidAsText, rankText, rateText, timeText } from './format'
import { usePortal } from './shell'
import type { Dispute, DisputeState, Explanation, MarketMoney, Statement } from './types'
import { CAPTION, CARD, MONO, PAGE_TITLE, PortalFailure, Section, TILE, TEXT_LINK, useWideScreen } from './ui'

// SC-18 statement detail (sc_18): status, net as the largest element, the reconciliation (D-B5-07 labels), lines per
// position and bonus, payout status with blockers in words, CSV download; a line's explanation opens as a bottom
// sheet on phones and a 360 px side panel at ≥ 1024 px (route …/lines/<lineId>).

// shortcut: the newest 50 disputes mark their lines; page through GET /v1/me/disputes when someone has more.
const DISPUTES_READ = 50
/** A decided dispute no longer blocks a new one (409 DISPUTE_OPEN only while one is open, D-B5-15). */
const DECIDED: ReadonlySet<DisputeState> = new Set(['upheld', 'not_upheld'])

export const statementPath = (runId: string): string => `/portal/earnings/${runId}`
export const linePath = (runId: string, lineId: string): string => `${statementPath(runId)}/lines/${lineId}`

export function StatementPage({ runId, lineId }: { readonly runId: string; readonly lineId?: string }) {
  const statement = useResource<Statement>(`/v1/me/statements/${runId}`)
  const disputes = useResource<Dispute[]>('/v1/me/disputes', { limit: DISPUTES_READ })
  const wide = useWideScreen()
  const router = useRouter()
  if (statement.error !== null) return <PortalFailure error={statement.error} onRetry={statement.reload} />
  if (statement.data === null) return <LoadingState label="Loading the statement" />
  const data = statement.data
  // The latest dispute of each line (the list is newest first).
  const byLine = new Map<string, Dispute>()
  for (const dispute of disputes.data ?? []) if (!byLine.has(dispute.line_id)) byLine.set(dispute.line_id, dispute)
  const failure = disputes.error === null ? null
    : <ErrorState section message={`Dispute states could not be loaded. ${errorMessage(disputes.error)}`} onRetry={disputes.reload} />
  // The failure shows once: in the open explanation (where the dispute link would be), else above the lines.
  const body = <StatementBody statement={data} disputes={byLine} notice={lineId === undefined ? failure : null} />
  if (lineId === undefined) return body
  // undefined = the dispute states are not known yet (loading or failed).
  const dispute = disputes.data === null ? undefined : byLine.get(lineId) ?? null
  const explanation = <LineExplanation runId={runId} lineId={lineId} market={data.market} dispute={dispute} failure={failure} />
  // replace: closing must not leave a history entry that reopens the sheet on Back.
  const close = () => router.replace(statementPath(runId))
  return (
    <div className="flex flex-col gap-space-md lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-space-lg lg:items-start">
      <div className="flex flex-col gap-space-md min-w-0">{body}</div>
      {wide === true && <aside data-side-panel aria-label="Line explanation" className={`${CARD} sticky top-20 flex flex-col gap-space-md`}>{explanation}<LinkButton href={statementPath(runId)} replace size="lg">Close the explanation</LinkButton></aside>}
      {wide === false && <BottomSheet title="Line explanation" onClose={close}>{explanation}</BottomSheet>}
    </div>
  )
}

function StatementBody({ statement, disputes, notice }: { readonly statement: Statement; readonly disputes: ReadonlyMap<string, Dispute>; readonly notice: ReactNode }) {
  const { profile, zone } = usePortal()
  const period = periodName(statement.period.starts_at, statement.period.ends_at, zone)
  const refs = statement.positions.map((position) => position.position_ref).join(', ')
  return (
    <>
      <div className="flex items-start justify-between gap-space-sm flex-wrap">
        <div className="min-w-0">
          <h1 className={PAGE_TITLE}>Statement {period}</h1>
          <p className={CAPTION}>{profile.display_name ?? ''}{refs === '' ? '' : ` · `}<span className={`${MONO} font-semibold`}>{refs}</span></p>
        </div>
        <DownloadCsv runId={statement.run_id} name={`statement-${isoDay(statement.period.starts_at, zone)}.csv`} />
      </div>
      <div className={`${CARD} p-space-sm flex items-center justify-between gap-space-sm flex-wrap`}>
        <div className="flex flex-col">
          <span className="font-caption text-caption uppercase tracking-wider text-tertiary font-semibold">Committed</span>
          <span className={`${MONO} text-on-surface-variant`}>{timeText(statement.committed_at, zone)}</span>
        </div>
        <StatusBadge state="committed" label="Final figures" />
      </div>
      <NetHero statement={statement} />
      <Reconciliation statement={statement} />
      {notice}
      <Lines statement={statement} disputes={disputes} />
    </>
  )
}

/** The file is named after the period's first day in the market zone (BUG-112), not the API's UTC day. */
function DownloadCsv({ runId, name }: { readonly runId: string; readonly name: string }) {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function download() {
    setBusy(true)
    setError(null)
    try {
      const answer = await api.get<Blob>(`/v1/me/statements/${runId}/download`, { responseType: 'blob', headers: { Accept: 'text/csv' } })
      saveFile(answer.data, name)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="lg" icon="download" loading={busy} onClick={download}>Download CSV</Button>
      {error !== null && <p role="alert" className="font-body-sm text-body-sm text-error">{error}</p>}
    </div>
  )
}

function NetHero({ statement }: { readonly statement: Statement }) {
  const { zone } = usePortal()
  const { instructions, blockers } = statement.payout
  return (
    <section aria-labelledby="net-title" data-testid="card" className={`${CARD} flex flex-col gap-1`}>
      <h2 id="net-title" className="font-caption text-caption uppercase tracking-wider text-on-surface-variant font-medium">Net amount</h2>
      <p className="font-display text-display text-on-surface tracking-tight font-semibold break-words">{marketMoney(statement.summary.net_minor, statement.market)}</p>
      {(instructions.length > 0 || blockers.length > 0) && (
        <div className={`mt-space-sm ${TILE} flex flex-col gap-1.5`}>
          {instructions.map((instruction, index) => (
            <div key={index} className="flex items-center justify-between gap-space-sm flex-wrap">
              <span className="flex items-center gap-2 font-body-lg text-body-lg text-on-surface">
                <Icon name="account_balance" size={18} className="text-primary" />
                {marketMoney(instruction.amount_minor, statement.market)} to {instruction.masked}
              </span>
              <span className={`${MONO} text-on-surface-variant`}>
                {instructionLabel(instruction.state)}{instruction.terminal_at === null ? '' : ` · ${timeText(instruction.terminal_at, zone)}`}
              </span>
            </div>
          ))}
          {blockers.map((blocker) => <p key={blocker.reason} className="font-body-lg text-body-lg text-on-surface-variant">{blockerText(blocker, zone)}</p>)}
        </div>
      )}
      {instructions.length === 0 && blockers.length === 0 && (
        <p className={CAPTION}>{BigInt(statement.summary.net_minor) > 0n ? 'No payout has been made for this statement yet.' : 'No payout is due for this statement.'}</p>
      )}
    </section>
  )
}

/** gross − withheld − clawback + adjustments = net (D-B5-07); every amount as it enters the sum. */
function Reconciliation({ statement }: { readonly statement: Statement }) {
  const { summary, market } = statement
  const clawback = BigInt(summary.clawback_minor)
  const negate = (minor: string) => (-BigInt(minor)).toString()
  return (
    <Section title="How the net amount adds up" icon="balance" aside={<span className={CAPTION}>Gross − withheld − recovered + adjustments = net</span>}>
      <dl className="flex flex-col gap-2">
        <Row label="Gross earnings" value={marketMoney(summary.gross_minor, market)} />
        <Row label="Adjustments (itemised below)" value={signedMoney(summary.adjustment_minor, market)} />
        <Row label="Withheld" value={signedMoney(negate(summary.withheld_minor), market)} />
        {clawback > 0n && <Row label="Recovered from what you owed" value={signedMoney(negate(summary.clawback_minor), market)} />}
        {clawback < 0n && <Row label="Carried to the amount you owe" value={signedMoney(negate(summary.clawback_minor), market)} />}
      </dl>
      <div className="flex items-center justify-between gap-space-sm bg-primary-container p-space-sm rounded-lg text-on-primary">
        <span className="font-caption text-caption tracking-wider uppercase">Net amount</span>
        <span className="font-data-mono-lg text-data-mono-lg font-bold">{marketMoney(summary.net_minor, market)}</span>
      </div>
    </Section>
  )
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between gap-space-sm py-1.5 px-2 rounded bg-surface-container-low/40">
      <dt className="font-body-lg text-body-lg text-on-surface">{label}</dt>
      <dd className="font-data-mono-md text-data-mono-md font-semibold text-on-surface">{value}</dd>
    </div>
  )
}

/** Lines per position (one position: no grouping level) and bonus, each with "How calculated". */
function Lines({ statement, disputes }: { readonly statement: Statement; readonly disputes: ReadonlyMap<string, Dispute> }) {
  const single = statement.positions.length === 1
  return (
    <>
      {statement.positions.map((position) => (
        <Section key={position.position_id} title={single ? 'Your earnings' : `Earnings of ${position.position_ref}`} icon="receipt_long"
          aside={<span className={CAPTION}>{paidAsText(position.paid_as)}</span>}>
          <ul className="flex flex-col gap-2.5">
            {position.bonuses.map((bonus) => (
              <li key={bonus.rule_key} className={`${TILE} flex flex-col gap-1`}>
                <div className="flex items-center justify-between gap-space-sm">
                  <span className="font-body-lg text-body-lg font-medium text-on-surface">{keyLabel(bonus.rule_key)}</span>
                  <span className="font-data-mono-md text-data-mono-md font-bold text-on-surface">{marketMoney(bonus.total_minor, statement.market)}</span>
                </div>
                <ul className="flex flex-col">
                  {bonus.lines.map((line) => {
                    const origin = originText(line.origin_kind)
                    const dispute = disputes.get(line.id)
                    return (
                      <li key={line.id} className="flex items-center justify-between gap-space-sm flex-wrap border-t border-surface-container first:border-t-0">
                        <span className="flex items-center gap-space-xs flex-wrap">
                          <span className={`${MONO} text-on-surface`}>{marketMoney(line.amount_minor, statement.market)}</span>
                          {origin !== null && <span className={CAPTION}>{origin}{line.original_period_id === null ? '' : ' of an earlier period'}</span>}
                          {dispute !== undefined && <StatusBadge state={DISPUTE_STATE[dispute.state].state} label={DISPUTE_STATE[dispute.state].label} />}
                        </span>
                        <Link href={linePath(statement.run_id, line.id)} className={TEXT_LINK}
                          aria-label={`How calculated: ${keyLabel(bonus.rule_key)}, ${marketMoney(line.amount_minor, statement.market)}`}>
                          How calculated <Icon name="info" size={14} />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {!single && (
            <div className="flex items-center justify-between font-body-lg text-body-lg">
              <span>Total of {position.position_ref}</span>
              <span className="font-data-mono-md text-data-mono-md font-bold">{marketMoney(position.total_minor, statement.market)}</span>
            </div>
          )}
        </Section>
      ))}
      {!single && statement.positions.length > 0 && (
        <div className={`${CARD} flex items-center justify-between font-body-lg text-body-lg`}>
          <span>Total of all your positions</span>
          <span className="font-data-mono-md text-data-mono-md font-bold">{marketMoney(statement.person_total_minor, statement.market)}</span>
        </div>
      )}
    </>
  )
}

/** API-29 explanation: sources aggregated per level (no other person named), steps, rounding, origin; dispute state. */
export function LineExplanation({ runId, lineId, market, dispute, failure }: {
  readonly runId: string
  readonly lineId: string
  readonly market: MarketMoney
  /** The line's latest dispute; null when it has none, undefined while the dispute states are not known. */
  readonly dispute: Dispute | null | undefined
  /** Shown in place of the dispute link when the dispute states could not be loaded. */
  readonly failure: ReactNode
}) {
  const { profile, zone } = usePortal()
  const explanation = useResource<Explanation>(`/v1/me/statement-lines/${lineId}/explanation`)
  if (explanation.error !== null) return <PortalFailure error={explanation.error} onRetry={explanation.reload} section />
  if (explanation.data === null) return <LoadingState label="Loading the explanation" />
  const data = explanation.data
  const unit = (part: Explanation['parts'][number]) => (part.base_unit === 'money' ? ` ${data.currency}` : part.base_unit === 'volume' ? ' volume' : '')
  return (
    <div className="flex flex-col gap-space-md">
      <div>
        <span className="font-caption text-caption uppercase tracking-wider text-primary font-semibold">How this line was calculated</span>
        <h2 className="font-title-md text-title-md text-on-surface">{keyLabel(data.rule.key)}</h2>
        {data.text[0] !== undefined && <p className="font-body-lg text-body-lg text-on-surface-variant">{data.text[0]}</p>}
        <p className="font-data-mono-md text-data-mono-md text-on-surface">{moneyText(data.amount_minor, data.currency, market.minor_unit)}</p>
      </div>
      <dl className={`${TILE} flex flex-col gap-1.5`}>
        <Fact label="Period">{periodName(data.period.starts_at, data.period.ends_at, zone)}</Fact>
        {data.rank_used.length > 0 && <Fact label="Rank used">{rankText(data.rank_used)}</Fact>}
        {data.origin !== null && (
          <Fact label="Origin">
            {originText(data.origin.kind) ?? 'Current period'}
            {data.origin.original_period === null ? '' : ` of ${periodName(data.origin.original_period.starts_at, data.origin.original_period.ends_at, zone)}`}
          </Fact>
        )}
      </dl>
      {data.parts.length > 0 && (
        <section aria-label="Sources" className="flex flex-col gap-1.5">
          <h3 className="font-caption text-caption font-semibold text-on-surface uppercase tracking-wider">Sources</h3>
          <ul className="flex flex-col gap-1.5">
            {data.parts.map((part) => (
              <li key={`${part.level ?? 'x'}-${part.label}`} className="flex items-start justify-between gap-space-sm py-1 px-2 rounded bg-surface-container-low">
                <span className="flex flex-col">
                  <span className="font-body-lg text-body-lg text-on-surface">{part.label.charAt(0).toUpperCase() + part.label.slice(1)}</span>
                  <span className={CAPTION}>
                    {part.count} {part.count === 1 ? 'source' : 'sources'}
                    {part.base === null ? '' : ` · base ${decimal(part.base)}${unit(part)}`}
                    {part.rate === null ? '' : ` · ${rateText(part.rate)}`}
                  </span>
                </span>
                <span className={`${MONO} text-on-surface font-semibold`}>{decimal(part.contribution)} {data.currency}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(data.steps.length > 0 || data.rounding !== null) && (
        <section aria-label="Steps" className="flex flex-col gap-1.5">
          <h3 className="font-caption text-caption font-semibold text-on-surface uppercase tracking-wider">Steps</h3>
          <ol className={`${TILE} flex flex-col gap-1 font-body-lg text-body-lg text-on-surface-variant list-decimal pl-8`}>
            {data.steps.map((step, index) => <li key={index}>{step.text}</li>)}
            {data.rounding !== null && <li>Rounded {data.rounding.mode.replace(/_/g, ' ')}: {decimal(data.rounding.before)} to {decimal(data.rounding.after)}.</li>}
          </ol>
        </section>
      )}
      {dispute != null && (
        <div className={`${TILE} flex flex-col gap-1`}>
          <StatusBadge state={DISPUTE_STATE[dispute.state].state} label={DISPUTE_STATE[dispute.state].label} />
          {dispute.explanation !== null && <p className="font-body-lg text-body-lg text-on-surface">{dispute.explanation}</p>}
          {dispute.explanation === null && <p className={CAPTION}>{dispute.due_at === null ? 'No response time is set.' : `Answer due by ${timeText(dispute.due_at, zone)}.`}</p>}
        </div>
      )}
      {dispute === undefined && failure}
      {dispute !== undefined && !profile.terminated && (dispute === null || DECIDED.has(dispute.state)) && (
        <LinkButton href={`${linePath(runId, lineId)}/dispute`} variant="destructive" size="lg" icon="flag">Dispute this line</LinkButton>
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

/** sc_18 bottom sheet: modal on phones (focus trapped, Escape and the close button leave). */
function BottomSheet({ title, onClose, children }: { readonly title: string; readonly onClose: () => void; readonly children: ReactNode }) {
  const dialog = useModalDialog(true, onClose)
  return (
    <dialog ref={dialog.ref} aria-label={title} aria-modal="true" onKeyDown={dialog.onKeyDown} onCancel={dialog.onCancel}
      className="fixed bottom-0 top-auto left-0 right-0 m-0 w-full max-w-none max-h-[80vh] overflow-y-auto bg-surface-container-lowest text-on-surface rounded-t-xl shadow-2xl p-space-md backdrop:bg-black/45">
      <div className="w-12 h-1.5 rounded-full bg-outline-variant mx-auto mb-space-sm" aria-hidden="true" />
      <div className="flex justify-end mb-space-sm">
        <button type="button" aria-label="Close the explanation" onClick={onClose}
          className={`w-11 h-11 rounded-lg bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-on-surface ${FOCUS_RING}`}>
          <Icon name="close" size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
