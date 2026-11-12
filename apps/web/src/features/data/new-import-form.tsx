'use client'

import { useRouter } from 'next/navigation'
import { Fragment, useState, type FormEvent } from 'react'
import { Button, LinkButton } from '../../components/button'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { FileInput, formatMegabytes } from '../../components/file-input'
import { SelectField, TextField } from '../../components/form-field'
import { PageHeader } from '../../components/page-header'
import { useToast } from '../../components/toast'
import { isApiError, newIdempotencyKey } from '../../lib/api'
import { errorMessage, fieldErrors } from '../../lib/messages'
import { MARKETS_PATH, marketName, type Market } from '../../lib/markets'
import { useResource } from '../../lib/use-resource'
import { periodErrors } from './period'
import { uploadForm, type UploadProgress } from './transfer'
import { IMPORT_FILES, type Batch, type ImportFile } from './types'


const FILE_LABELS: Readonly<Record<ImportFile, string>> = {
  participants: 'Participants file (participants.csv)',
  orders: 'Orders file (orders.csv)',
  payout_lines: 'Payout lines file (payout_lines.csv)',
}

// MVP_A_SPEC 3.1: the published columns of each export file.
const REQUIRED_COLUMNS: Readonly<Record<ImportFile, string>> = {
  participants: 'participant_id, type, enrolled_month, sponsor_id',
  orders: 'order_id, month, day, buyer_id, amount_cents, volume_cents, purpose, is_starter_kit, refunded_cents, refund_month',
  payout_lines: 'line_id, month, payee_id, bonus_type, source_kind, source_order_id, amount_cents',
}

type Field = 'market' | 'period_from' | 'period_to'
type Values = Readonly<Record<Field, string>>
type Files = Readonly<Partial<Record<ImportFile, File>>>
type Errors = Readonly<Partial<Record<Field | ImportFile, string>>>

const fieldId = (name: Field | ImportFile) => `import-${name}`

/** GET /v1/imports/limits: the largest file the API accepts. */
export interface ImportLimits {
  readonly max_file_bytes: number
}

/** Client checks before sending; the server validates everything again. */
export function validateImport(values: Values, files: Files): Errors {
  const missing = IMPORT_FILES.filter((file) => files[file] === undefined)
  return {
    ...(values.market === '' ? { market: 'Choose the market.' } : {}),
    ...periodErrors(values.period_from, values.period_to),
    ...Object.fromEntries(missing.map((file) => [file, `Choose the ${file.replace('_', ' ')} CSV file.`])),
  }
}

/** Server refusals as field errors where they name a field or file, else one summary message. */
function serverErrors(error: unknown): Errors {
  const fields = fieldErrors(error)
  const named = Object.fromEntries((['market', 'period_from', 'period_to'] as const).flatMap((name) => (fields[name] === undefined ? [] : [[name, fields[name]]])))
  if (Object.keys(named).length > 0) return named
  if (isApiError(error, 'MARKET_UNKNOWN')) return { market: errorMessage(error) }
  const details = (isApiError(error) ? error.details : null) as { file?: unknown; files?: unknown } | null
  const file = typeof details?.file === 'string' ? details.file : Array.isArray(details?.files) ? details.files[0] : undefined
  return (IMPORT_FILES as readonly unknown[]).includes(file) ? { [file as ImportFile]: errorMessage(error) } : {}
}

function formOf(values: Values, files: Files): FormData {
  const form = new FormData()
  for (const name of ['market', 'period_from', 'period_to'] as const) form.append(name, values[name].trim())
  // The extension is already checked; some systems label CSV files application/octet-stream, which the API refuses.
  for (const file of IMPORT_FILES) form.append(file, new Blob([files[file]!], { type: 'text/csv' }), `${file}.csv`)
  return form
}

function Progress({ progress }: { readonly progress: UploadProgress }) {
  const done = progress.loaded >= progress.total
  return (
    <div className="data-progress">
      <progress max={progress.total} value={progress.loaded} aria-label="Upload progress" />
      <p role="status">
        {done
          ? 'Files sent. Checking them against the published format…'
          : `Sending files: ${formatMegabytes(progress.loaded)} of ${formatMegabytes(progress.total)}`}
      </p>
    </div>
  )
}

/** SC-24 upload: three export files, the market and the period range; validated before anything is stored. */
export function NewImportForm() {
  const router = useRouter()
  const toast = useToast()
  const markets = useResource<readonly Market[]>(MARKETS_PATH)
  const limits = useResource<ImportLimits>('/v1/imports/limits')
  const [values, setValues] = useState<Values>({ market: '', period_from: '', period_to: '' })
  const [files, setFiles] = useState<Files>({})
  const [errors, setErrors] = useState<Errors>({})
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [busy, setBusy] = useState(false)
  // One key per upload attempt; a changed form is a different request and gets a new key.
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)

  const setValue = (name: Field, value: string) => {
    setValues((current) => ({ ...current, [name]: value }))
    setIdempotencyKey(null)
  }
  const setFile = (name: ImportFile, chosen: readonly File[]) => {
    setFiles((current) => ({ ...current, [name]: chosen[0] }))
    setIdempotencyKey(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = validateImport(values, files)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setSummary(Object.entries(found).map(([name, message]) => ({ fieldId: fieldId(name as Field), message: message! })))
      return
    }
    const key = idempotencyKey ?? newIdempotencyKey()
    setIdempotencyKey(key)
    setBusy(true)
    setSummary([])
    try {
      const batch = await uploadForm<Batch>('/v1/imports', formOf(values, files), key, setProgress)
      toast({ message: batch.state === 'rejected' ? 'The files were rejected. Nothing was stored.' : 'The files passed validation.', tone: batch.state === 'rejected' ? 'info' : 'success' })
      router.push(`/imports/${batch.id}`)
    } catch (error) {
      const named = serverErrors(error)
      setErrors(named)
      const items = Object.entries(named).map(([name, message]) => ({ fieldId: fieldId(name as Field), message: message! }))
      setSummary(items.length > 0 ? items : [{ message: errorMessage(error) }])
      setProgress(null)
      setBusy(false)
    }
  }

  const month = (name: 'period_from' | 'period_to', label: string) => (
    <TextField
      id={fieldId(name)} label={label} type="month" placeholder="2025-01" helper="Year and month, for example 2025-01."
      value={values[name]} error={errors[name]} disabled={busy}
      onChange={(event) => setValue(name, event.target.value)}
    />
  )

  return (
    <>
      <PageHeader title="Upload export" summary="The files are checked before any row is stored. Files with names, contacts, addresses, identity or bank data are rejected." />
      <form className="form" onSubmit={submit} noValidate>
        <ErrorSummary items={summary} />
        <SelectField
          id={fieldId('market')} label="Market"
          placeholder={markets.loading ? 'Loading markets…' : 'Choose a market'}
          helper={markets.error === null ? undefined : errorMessage(markets.error)}
          options={(markets.data ?? []).map((market) => ({ value: market.code, label: marketName(market) }))}
          value={values.market} error={errors.market} disabled={busy} onChange={(event) => setValue('market', event.target.value)}
        />
        {month('period_from', 'First month')}
        {month('period_to', 'Last month')}
        {IMPORT_FILES.map((file) => (
          <FileInput
            key={file} id={fieldId(file)} label={FILE_LABELS[file]} name={file} extensions={['.csv']} maxBytes={limits.data?.max_file_bytes}
            error={errors[file]} disabled={busy} onFiles={(chosen) => setFile(file, chosen)}
          />
        ))}
        <details>
          <summary>Required columns</summary>
          <dl className="data-facts">
            {IMPORT_FILES.map((file) => (
              <Fragment key={file}>
                <dt>{file}.csv</dt>
                <dd className="data-code">{REQUIRED_COLUMNS[file]}</dd>
              </Fragment>
            ))}
          </dl>
        </details>
        {progress !== null && <Progress progress={progress} />}
        <div className="form-actions">
          <LinkButton href="/imports">Cancel</LinkButton>
          <Button type="submit" variant="primary" loading={busy}>Upload and validate</Button>
        </div>
      </form>
    </>
  )
}
