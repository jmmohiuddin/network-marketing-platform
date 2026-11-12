'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { Dialog } from '../../components/dialog'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { Checkbox, SelectField, TextField } from '../../components/form-field'
import { useToast } from '../../components/toast'
import { isApiError, newIdempotencyKey } from '../../lib/api'
import { errorMessage, fieldErrors } from '../../lib/messages'
import { MARKETS_PATH, marketName, type Market } from '../../lib/markets'
import { useResource } from '../../lib/use-resource'
import { REPORT_NAMES } from './format'
import { periodErrors } from './period'
import { REPORT_CODES, type ReportCode, type Snapshot } from './types'

type Field = 'market' | 'period_from' | 'period_to' | 'reports'
type Errors = Readonly<Partial<Record<Field, string>>>

const FORM_ID = 'create-snapshot'
const fieldId = (field: Field) => `${FORM_ID}-${field}`

export interface SnapshotRequest {
  readonly market: string
  readonly period_from: string
  readonly period_to: string
  readonly reports: readonly ReportCode[]
}

export function validateSnapshotRequest(request: SnapshotRequest): Errors {
  return {
    ...(request.market === '' ? { market: 'Choose the market.' } : {}),
    ...periodErrors(request.period_from, request.period_to),
    ...(request.reports.length === 0 ? { reports: 'Choose at least one report.' } : {}),
  }
}

/** Server refusals that concern one field; NO_DATA_FOR_RANGE names the months no loaded import covers. */
function serverErrors(error: unknown): Errors {
  const fields = fieldErrors(error)
  const named = Object.fromEntries((['market', 'period_from', 'period_to', 'reports'] as const).flatMap((name) => (fields[name] === undefined ? [] : [[name, fields[name]]])))
  if (Object.keys(named).length > 0) return named
  if (isApiError(error, 'MARKET_UNKNOWN')) return { market: errorMessage(error) }
  if (isApiError(error, 'CURRENCY_NOT_SUPPORTED')) return { reports: errorMessage(error) }
  if (isApiError(error, 'NO_DATA_FOR_RANGE')) {
    const months = (error.details as { uncovered_months?: unknown } | null)?.uncovered_months
    const list = Array.isArray(months) ? ` Months without loaded data: ${months.join(', ')}.` : ''
    return { period_from: `${errorMessage(error)}${list}` }
  }
  return {}
}

export interface CreateSnapshotDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  /** Fields filled in on opening (a new snapshot for an outdated one's market and range). */
  readonly initial?: Partial<SnapshotRequest>
}

/** API-04: a snapshot of R1-R5 for a market and a range of whole months, computed by a job. */
export function CreateSnapshotDialog({ open, onClose, initial }: CreateSnapshotDialogProps) {
  const api = useApi()
  const router = useRouter()
  const toast = useToast()
  const markets = useResource<readonly Market[]>(open ? MARKETS_PATH : null)
  const [request, setRequest] = useState<SnapshotRequest>({ market: '', period_from: '', period_to: '', reports: REPORT_CODES, ...initial })
  const [errors, setErrors] = useState<Errors>({})
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [busy, setBusy] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)

  const change = (next: Partial<SnapshotRequest>) => {
    setRequest((current) => ({ ...current, ...next }))
    setIdempotencyKey(null)
  }
  const toggle = (code: ReportCode, on: boolean) =>
    change({ reports: REPORT_CODES.filter((item) => (item === code ? on : request.reports.includes(item))) })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = validateSnapshotRequest(request)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setSummary(Object.entries(found).map(([field, message]) => ({ fieldId: fieldId(field as Field), message: message! })))
      return
    }
    const key = idempotencyKey ?? newIdempotencyKey()
    setIdempotencyKey(key)
    setBusy(true)
    try {
      const body = { ...request, period_from: request.period_from.trim(), period_to: request.period_to.trim() }
      const { data } = await api.post<Snapshot>('/v1/compliance/snapshots', body, { idempotencyKey: key })
      toast({ message: 'The snapshot is being computed.', tone: 'info' })
      router.push(`/compliance/snapshots/${data.id}`)
    } catch (error) {
      const named = serverErrors(error)
      setErrors(named)
      const items = Object.entries(named).map(([field, message]) => ({ fieldId: fieldId(field as Field), message: message! }))
      setSummary(items.length > 0 ? items : [{ message: errorMessage(error) }])
      setBusy(false)
    }
  }

  const month = (field: 'period_from' | 'period_to', label: string) => (
    <TextField
      id={fieldId(field)} label={label} type="month" placeholder="2025-01" helper="Year and month, for example 2025-01."
      value={request[field]} error={errors[field]} onChange={(event) => change(field === 'period_from' ? { period_from: event.target.value } : { period_to: event.target.value })}
    />
  )
  const footer = (
    <>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" form={FORM_ID} variant="primary" loading={busy}>Create snapshot</Button>
    </>
  )
  return (
    <Dialog open={open} onClose={busy ? () => undefined : onClose} title="Create snapshot" footer={footer}>
      <form id={FORM_ID} className="form" onSubmit={submit} noValidate>
        <ErrorSummary items={summary} />
        <p className="data-note">Every month of the range must be covered by a loaded import of the market. The snapshot is computed from that data and never changes afterwards.</p>
        <SelectField
          id={fieldId('market')} label="Market" data-autofocus
          placeholder={markets.loading ? 'Loading markets…' : 'Choose a market'}
          helper={markets.error === null ? undefined : errorMessage(markets.error)}
          options={(markets.data ?? []).map((market) => ({ value: market.code, label: marketName(market) }))}
          value={request.market} error={errors.market} onChange={(event) => change({ market: event.target.value })}
        />
        {month('period_from', 'First month')}
        {month('period_to', 'Last month')}
        <fieldset className="data-fieldset" id={fieldId('reports')} tabIndex={-1}>
          <legend>Reports</legend>
          {REPORT_CODES.map((code) => (
            <Checkbox key={code} label={`${code} ${REPORT_NAMES[code]}`} checked={request.reports.includes(code)} onChange={(event) => toggle(code, event.target.checked)} />
          ))}
          {errors.reports !== undefined && <p className="field-error">{errors.reports}</p>}
        </fieldset>
      </form>
    </Dialog>
  )
}
