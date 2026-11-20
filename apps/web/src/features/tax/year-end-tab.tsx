'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { Modal } from '../../components/modal'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { Stepper, type Step } from '../../components/stepper'
import { isApiError, newIdempotencyKey } from '../../lib/api'
import { useCursorPages } from '../../lib/cursor-pages'
import { countLabel, formatDateTime, formatDay } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { MONO, NOTE } from '../admin/ui'
import { PeriodLink } from '../cases/refs'
import { saveFile } from '../data/transfer'
import { marketMoney } from '../periods/format'
import { useKeptData } from '../plans/ui'
import { csvRowCount } from '../views/list-tools'
import { generationText, percentText, REASON_TEXT } from './format'
import type { TaxTabProps } from './tax-page'
import type { Generation, GenerationResult, TaxForm, YearEnd, YearEndPayee } from './types'

const CARD = 'bg-surface-container-lowest rounded-lg shadow-sm p-space-md flex flex-col gap-space-sm min-w-0'
const HEADING = 'font-section-heading text-section-heading text-on-surface'

const csvHeaders = { Accept: 'text/csv' }

/** The four stages of a tax year's statements (PLAN B-MKT §5 SC-12), from the preview and the generations. */
export function yearEndSteps(yearEnd: YearEnd, generations: readonly Generation[], taxYear: number): Step[] {
  // A ledger mismatch is not one of the reasons, but generation refuses it too (INVARIANT_FAILED).
  const blocked = yearEnd.reasons.length > 0 || !yearEnd.totals.equal
  const latest = generations[0]
  return [
    { label: 'Tax year', status: 'done', detail: yearEnd.bounds === null ? String(taxYear) : `${formatDay(yearEnd.bounds.starts_on)} to ${formatDay(yearEnd.bounds.ends_on)}` },
    !blocked
      ? { label: 'Validate', status: 'done', detail: 'Year closed, ledger equal' }
      : { label: 'Validate', status: 'blocked', detail: yearEnd.reasons.length > 0 ? countLabel(yearEnd.reasons.length, 'open point') : 'Ledger mismatch' },
    latest === undefined
      ? { label: 'Generate', status: blocked ? 'todo' : 'current' }
      : { label: 'Generate', status: 'done', detail: `Last: ${generationText(latest)}` },
    { label: 'Export for filing', status: latest === undefined ? 'todo' : 'current' },
  ]
}

/** Validate: why statements cannot be generated yet (closed periods, form rule, tax year), missing tax ids, ledger check. */
function Validation({ yearEnd, market, onMissing }: { readonly yearEnd: YearEnd; readonly market: Market; readonly onMissing: () => void }) {
  const { totals } = yearEnd
  return (
    <section className={CARD} aria-labelledby="validate-title">
      <h2 id="validate-title" className={HEADING}>Validate</h2>
      {yearEnd.reasons.length === 0
        ? <p className="font-body-sm text-body-sm text-on-surface">The tax year has ended and every period of it with committed runs is closed.</p>
        : (
          <ul aria-label="Open points" className="flex flex-col gap-space-xs">
            {yearEnd.reasons.map((reason) => <li key={reason} className="font-body-sm text-body-sm text-error">{REASON_TEXT[reason]}</li>)}
          </ul>
        )}
      {yearEnd.open_period_ids.length > 0 && (
        <ul aria-label="Periods to close" className="flex flex-wrap gap-space-sm">
          {yearEnd.open_period_ids.map((id) => <li key={id}><PeriodLink id={id} /></li>)}
        </ul>
      )}
      <p className="font-body-sm text-body-sm text-on-surface">
        {totals.held === 0 ? 'Every included payee has a tax id.' : `${countLabel(totals.held, 'included payee')} without a tax id: held, no statement until a tax id is recorded. `}
        {totals.held > 0 && <button type="button" className="text-primary font-semibold hover:underline" onClick={onMissing}>Show missing tax ids</button>}
      </p>
      <p className="font-body-sm text-body-sm text-on-surface" data-testid="ledger-check">
        Ledger check: withheld {marketMoney(totals.withheld_minor, market)} {totals.equal ? '=' : '≠'} withholding payable {marketMoney(totals.ledger_withheld_minor, market)}
        {' '}<StatusBadge state={totals.equal ? 'accepted' : 'blocked'} label={totals.equal ? 'Equal' : 'Mismatch'} />
      </p>
    </section>
  )
}

/** POST /v1/tax/year-end-forms (tax.forms, step-up by the API client): one Idempotency-Key per attempt, renewed after a success. */
function GenerateAction({ marketId, taxYear, onDone }: { readonly marketId: string; readonly taxYear: number; readonly onDone: () => void }) {
  const api = useApi()
  const [key, setKey] = useState(newIdempotencyKey)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [problem, setProblem] = useState<unknown>(null)
  async function generate() {
    setBusy(true)
    setProblem(null)
    try {
      setResult((await api.post<GenerationResult>('/v1/tax/year-end-forms', { market_id: marketId, tax_year: taxYear }, { idempotencyKey: key })).data)
      setKey(newIdempotencyKey())
      onDone()
    } catch (error) {
      setProblem(error)
    } finally {
      setBusy(false)
    }
  }
  const periods = isApiError(problem, 'TAX_YEAR_NOT_CLOSED') ? ((problem.details as { period_ids?: string[] } | null)?.period_ids ?? []) : []
  return (
    <>
      <Button variant="primary" icon="auto_mode" loading={busy} className="self-start" data-testid="primary-action" onClick={() => void generate()}>Generate statements</Button>
      <p className={NOTE}>Each payee whose totals changed gets a new version; earlier versions are kept. You will be asked for a code from your authenticator app.</p>
      {result !== null && (
        <Banner tone="success" title="Statements generated">
          {generationText(result)}.{result.held.length > 0 && ` Held: ${result.held.map((held) => held.external_ref).join(', ')}.`}
        </Banner>
      )}
      {problem !== null && (
        <Banner tone="danger" title={periods.length > 0 ? 'Close these periods first' : 'No statements generated'}>
          {periods.length > 0
            ? <span className="flex flex-wrap gap-space-sm">{periods.map((id) => <PeriodLink key={id} id={id} />)}</span>
            : errorMessage(problem)}
        </Banner>
      )}
    </>
  )
}

type ExportOutcome = { readonly kind: 'ready'; readonly file: Blob; readonly rows: number } | { readonly kind: 'failed'; readonly message: string }

/** EXPORT_ROW_CAP_EXCEEDED in words; other refusals (NO_FORMS) as the API says them. */
function exportRefusal(error: unknown): string {
  if (!isApiError(error, 'EXPORT_ROW_CAP_EXCEEDED')) return errorMessage(error)
  const details = (error.details ?? {}) as { row_count?: number; row_cap?: number }
  return `${countLabel(details.row_count ?? 0, 'row')}, more than the ${countLabel(details.row_cap ?? 0, 'row')} an export may hold. The refused export is recorded in the audit log.`
}

/** POST /v1/tax/year-end-forms/export (tax.forms, step-up): the latest version per payee with full tax ids, then a row-count dialog. */
function ExportForFiling({ marketId, taxYear }: { readonly marketId: string; readonly taxYear: number }) {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null)
  async function run() {
    setBusy(true)
    try {
      const { data } = await api.post<Blob>('/v1/tax/year-end-forms/export', { market_id: marketId, tax_year: taxYear }, { responseType: 'blob', headers: csvHeaders })
      setOutcome({ kind: 'ready', file: data, rows: csvRowCount(await data.text()) })
    } catch (error) {
      setOutcome({ kind: 'failed', message: exportRefusal(error) })
    } finally {
      setBusy(false)
    }
  }
  const close = () => setOutcome(null)
  const ready = outcome?.kind === 'ready' ? outcome : null
  return (
    <>
      <Button icon="file_download" loading={busy} className="self-start" onClick={() => void run()}>Export for filing</Button>
      <Modal open={outcome !== null} onClose={close} title="Export for filing" icon="file_download" size="sm"
        footer={<>
          <Button variant="secondary" onClick={close}>Close</Button>
          {ready !== null && <Button variant="primary" icon="save" data-autofocus onClick={() => {
            saveFile(ready.file, `tax-statements-${taxYear}.csv`)
            close()
          }}>Save CSV file</Button>}
        </>}>
        {ready !== null && (
          <p data-testid="export-count">
            {`${countLabel(ready.rows, 'row')}, one per payee (latest version). The file contains full tax ids: keep it safe. The export is recorded in the audit log.`}
          </p>
        )}
        {outcome?.kind === 'failed' && <Banner tone="danger" title="No export">{outcome.message}</Banner>}
      </Modal>
    </>
  )
}

/** sc_12 statement inspector: the payee's latest statement version, its totals by rule, and Download. focus: move focus here on mount (after Inspect). */
function Inspector({ marketId, taxYear, payee, market, focus }: { readonly marketId: string; readonly taxYear: number; readonly payee: string; readonly market: Market; readonly focus: boolean }) {
  const api = useApi()
  const heading = useRef<HTMLHeadingElement>(null)
  // Below xl the inspector sits under the payee table: focusing its heading also scrolls it into view.
  useEffect(() => {
    if (focus) heading.current?.focus()
  }, [focus])
  const forms = useResource<TaxForm[]>('/v1/tax/year-end-forms', { market_id: marketId, tax_year: taxYear, participant_id: payee })
  const [problem, setProblem] = useState<string | null>(null)
  const form = forms.data?.[0]
  async function download(target: TaxForm) {
    setProblem(null)
    try {
      const { data } = await api.get<Blob>(`/v1/tax/year-end-forms/${target.id}/download`, { responseType: 'blob', headers: csvHeaders })
      saveFile(data, `${target.form_type}-${taxYear}-${target.participant.external_ref}-v${target.version}.csv`)
    } catch (error) {
      setProblem(errorMessage(error))
    }
  }
  return (
    <section className={CARD} aria-labelledby="inspector-title" data-testid="inspector">
      <h2 id="inspector-title" ref={heading} tabIndex={-1} className={`${HEADING} focus:outline-none`}>Statement inspector</h2>
      {forms.error !== null && <LoadFailure error={forms.error} onRetry={forms.reload} section />}
      {forms.data === null && forms.error === null && <LoadingState label="Loading the statement" />}
      {forms.data !== null && form === undefined && <p className={NOTE}>No statement has been generated for this payee in this tax year.</p>}
      {form !== undefined && (
        <>
          <div className="bg-surface-container-low p-space-sm rounded flex flex-col gap-1">
            <span className="font-body-md text-body-md font-semibold text-on-surface">{form.participant.external_ref}</span>
            <span className="font-caption text-caption text-secondary">{form.form_type} · tax id <span className={MONO}>{form.tax_id_masked}</span></span>
            {/* shortcut: the staff API lists only the latest version (with the count); list older versions when it returns them. */}
            <span className="font-caption text-caption text-secondary">Version {form.version} of {form.versions} · generated {formatDateTime(form.created_at)}</span>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-space-xs">
            {([['Gross', form.totals.gross_minor], ['Taxable', form.totals.taxable_minor], ['Withheld', form.totals.withheld_minor]] as const).map(([label, minor]) => (
              <div key={label} className="p-space-sm bg-surface-container-low rounded">
                <dt className="font-caption text-[11px] font-semibold text-secondary uppercase">{label}</dt>
                <dd className={`${MONO} font-semibold text-on-surface`}>{marketMoney(minor, market)}</dd>
              </div>
            ))}
          </dl>
          {form.totals.by_rule.length > 0 && (
            <ul aria-label="Totals by rule" className="flex flex-col gap-1">
              {form.totals.by_rule.map((rule) => (
                <li key={`${rule.rule_id}:${rule.rate}`} className="font-caption text-caption text-on-surface-variant">
                  <span className={MONO}>{rule.rule_id}</span> · {percentText(rule.rate)} · taxable {marketMoney(rule.taxable_minor, market)} · withheld {marketMoney(rule.withheld_minor, market)}
                </li>
              ))}
            </ul>
          )}
          <Button icon="download" className="self-start" onClick={() => void download(form)}>Download statement (CSV)</Button>
          {problem !== null && <p role="alert" className="font-caption text-caption text-error">{problem}</p>}
        </>
      )}
    </section>
  )
}

interface YearEndTabProps extends TaxTabProps {
  readonly onChanged: () => void
  readonly payeeId: string | null
  readonly onInspect: (participantId: string | null) => void
  readonly onShowMissing: () => void
}

/** SC-12 Year-end statements: stepper, validation, generate and export (tax.forms), payee table and statement inspector. */
export function YearEndTab({ market, taxYear, onChanged, payeeId, onInspect, onShowMissing }: YearEndTabProps) {
  const { can, readOnly } = useSession()
  const pages = useCursorPages()
  // Kept during reloads, so the outcome of Generate stays on screen while the totals load again.
  const yearEnd = useKeptData(useResource<YearEnd>('/v1/tax/year-end', { market_id: market.id, tax_year: taxYear, cursor: pages.cursor }))
  const generations = useKeptData(useResource<Generation[]>('/v1/tax/year-end-generations', { market_id: market.id, tax_year: taxYear }))
  const payee = payeeId !== null && isUuid(payeeId) ? payeeId : null
  const [inspected, setInspected] = useState(false)
  if (yearEnd.error !== null) return <LoadFailure error={yearEnd.error} onRetry={yearEnd.reload} section />
  if (generations.error !== null) return <LoadFailure error={generations.error} onRetry={generations.reload} section />
  if (yearEnd.data === null || generations.data === null) return <LoadingState label="Loading the tax year" />
  const data = yearEnd.data
  const canForm = can('tax.forms') && !readOnly
  const nextCursor = typeof yearEnd.meta.next_cursor === 'string' ? yearEnd.meta.next_cursor : null
  const changed = () => {
    yearEnd.reload()
    generations.reload()
    onChanged()
  }
  const columns = [
    { key: 'payee', header: 'Payee', cell: (row: YearEndPayee) => <Link className={`${MONO} text-primary font-semibold hover:underline`} href={`/people/${row.participant.id}?tab=tax`}>{row.participant.external_ref}</Link> },
    { key: 'tax_id', header: 'Tax id', cell: (row: YearEndPayee) => <StatusBadge state={row.tax_id === 'present' ? 'accepted' : 'held'} label={row.tax_id === 'present' ? 'On file' : 'Missing'} /> },
    { key: 'gross', header: `Gross (${market.currency})`, align: 'end' as const, cell: (row: YearEndPayee) => <span className={MONO}>{marketMoney(row.gross_minor, market)}</span> },
    { key: 'withheld', header: `Withheld (${market.currency})`, align: 'end' as const, cell: (row: YearEndPayee) => <span className={MONO}>{marketMoney(row.withheld_minor, market)}</span> },
    { key: 'statement', header: 'Statement', cell: (row: YearEndPayee) => (!row.included ? 'Not included' : row.tax_id === 'missing' ? 'Held' : row.latest_version === null ? 'Not generated yet' : `Version ${row.latest_version}`) },
    { key: 'actions', header: 'Actions', align: 'end' as const, cell: (row: YearEndPayee) => (
      <Button size="sm" icon="visibility" aria-label={`Inspect the statement of ${row.participant.external_ref}`} onClick={() => {
        setInspected(true)
        onInspect(row.participant.id)
      }}>Inspect</Button>
    ) },
  ]
  return (
    <div className="flex flex-col gap-space-md">
      <Stepper label="Year-end statement steps" steps={yearEndSteps(data, generations.data, taxYear)} />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-md items-start">
        <div className="xl:col-span-8 flex flex-col gap-space-md min-w-0">
          <Validation yearEnd={data} market={market} onMissing={onShowMissing} />
          {canForm && (
            <section className={CARD} aria-labelledby="generate-title">
              <h2 id="generate-title" className={HEADING}>Generate and export</h2>
              <GenerateAction marketId={market.id} taxYear={taxYear} onDone={changed} />
              <ExportForFiling marketId={market.id} taxYear={taxYear} />
            </section>
          )}
          <section className={CARD} aria-labelledby="payees-title" data-testid="card">
            <h2 id="payees-title" className={HEADING}>Payees of tax year {taxYear}</h2>
            <p className={NOTE}>
              {countLabel(data.totals.included, 'payee')} included: tax was withheld{data.form_rule?.min_gross_minor == null ? '' : `, or gross reached ${marketMoney(data.form_rule.min_gross_minor, market)}`}. {data.totals.held} held for a missing tax id.
            </p>
            <DataTable bare caption={`Payees of tax year ${taxYear}`} columns={columns} rows={data.payees} rowKey={(row) => row.participant.id}
              loading={yearEnd.loading} selectedKey={payee ?? undefined} stackOnPhone empty={{ title: 'No payee was paid in this tax year.' }}
              pagination={{ hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor) }} />
          </section>
        </div>
        <div className="xl:col-span-4 flex flex-col gap-space-md min-w-0">
          {payee === null
            ? <section className={CARD} aria-labelledby="inspector-title"><h2 id="inspector-title" className={HEADING}>Statement inspector</h2><p className={NOTE}>Inspect a payee to see its statement and download it.</p></section>
            : <Inspector key={payee} marketId={market.id} taxYear={taxYear} payee={payee} market={market} focus={inspected} />}
        </div>
      </div>
    </div>
  )
}
