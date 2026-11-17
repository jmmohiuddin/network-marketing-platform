'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { FileDropZone } from '../../components/file-drop-zone'
import { Checkbox, Select, TextInput } from '../../components/form-field'
import { ConfirmDialog } from '../../components/modal'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { ApiError, newIdempotencyKey } from '../../lib/api'
import { countLabel, formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { FormDialog } from '../admin/form-dialog'
import { CHECK_GRID, FIELDSET, LEGEND } from '../admin/ui'
import { currencyOf, money, versionApi, type Currency } from './format'
import type { DraftScope } from './rules-tab'
import { SIMULATIONS_PATH } from './simulations'
import type { Golden, GoldenResult, Mismatch, SimulationRow } from './types'
import { CARD, H2, MONO, NOTE, explainedError, type PlanData } from './ui'

const NAME_ID = 'golden-name'
const FILE_ID = 'golden-file'
const SIMULATION_ID = 'golden-simulation'

/** POST …/golden-datasets/run (plan.simulate): every golden of the version against its current rules; last_result kept. */
export function RunSuiteButton({ scope, primary = false }: { readonly scope: DraftScope; readonly primary?: boolean }) {
  const api = useApi()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  async function run() {
    setBusy(true)
    setFailure(null)
    try {
      const { data } = await api.post<readonly { status: 'pass' | 'fail' }[]>(`${versionApi(scope.plan.id, scope.version.version)}/golden-datasets/run`, undefined, { idempotencyKey: newIdempotencyKey() })
      const failed = data.filter((r) => r.status === 'fail').length
      toast({ message: failed === 0 ? `${countLabel(data.length, 'golden dataset')} passed.` : `${countLabel(failed, 'golden dataset')} of ${data.length} failed.`, tone: failed === 0 ? 'success' : 'info' })
      scope.reload()
    } catch (error) {
      setFailure(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant={primary ? 'primary' : 'secondary'} icon="fact_check" loading={busy} onClick={run}>Run golden suite</Button>
      {failure !== null && <span role="alert" className="font-caption text-caption text-error">The suite did not run. {errorMessage(failure)}</span>}
    </>
  )
}

/** Covers: the extension rules a golden case proves (FR-PLN-003). */
function CoversField({ scope, covers, onChange }: { readonly scope: DraftScope; readonly covers: readonly string[]; readonly onChange: (covers: readonly string[]) => void }) {
  const extensions = scope.version.rules.filter((r) => r.extension).map((r) => r.rule_key)
  return (
    <fieldset className={FIELDSET}>
      <legend className={LEGEND}>Extension rules it covers</legend>
      {extensions.length === 0 && <p className={NOTE}>This version has no extension rule to cover.</p>}
      <div className={CHECK_GRID}>
        {extensions.map((key) => (
          <Checkbox key={key} label={key} checked={covers.includes(key)} onChange={(event) => onChange(event.target.checked ? [...covers, key] : covers.filter((k) => k !== key))} />
        ))}
      </div>
    </fieldset>
  )
}

/** Freeze a completed simulation as a golden case: input = its snapshot, expected = its lines (AC-GLD-2). */
export function FreezeDialog({ scope, simulationId, onClose }: { readonly scope: DraftScope; readonly simulationId?: string; readonly onClose: () => void }) {
  const api = useApi()
  const toast = useToast()
  const simulations = useResource<readonly SimulationRow[]>(simulationId === undefined ? SIMULATIONS_PATH : null, { plan_version_id: scope.version.id, limit: 50 })
  const completed = (simulations.data ?? []).filter((s) => s.state === 'completed')
  const [chosen, setChosen] = useState(simulationId ?? '')
  const [name, setName] = useState('')
  const [covers, setCovers] = useState<readonly string[]>([])
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const source = simulationId ?? (chosen === '' ? completed[0]?.id ?? '' : chosen)
  function submit(idempotencyKey: string) {
    const found = { [NAME_ID]: name.trim() === '' ? 'Enter a name for the golden case.' : null, [SIMULATION_ID]: source === '' ? 'Run a simulation of this version first.' : null }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0) return { items }
    return {
      items: [],
      fieldIds: { name: NAME_ID },
      send: async () => {
        try {
          await api.post(`${versionApi(scope.plan.id, scope.version.version)}/golden-datasets`, { name: name.trim(), covers, from_simulation_id: source }, { idempotencyKey })
        } catch (failure) {
          throw explainedError(failure)
        }
        toast({ message: `Golden case ${name.trim()} saved.` })
        onClose()
        scope.reload()
      },
    }
  }
  return (
    <FormDialog title="Save as golden case" submitLabel="Save golden case" onClose={onClose} onSubmit={submit}>
      <p className={NOTE}>The simulation&apos;s input and its lines become a golden case of this draft; the suite then checks every later change against them.</p>
      {simulationId === undefined && (
        <Select id={SIMULATION_ID} label="Simulation" value={source} error={errors[SIMULATION_ID]} placeholder={completed.length === 0 ? 'No completed simulation' : undefined}
          options={completed.map((s) => ({ value: s.id, label: `Requested ${formatDateTime(s.requested_at)}` }))} onChange={(event) => setChosen(event.target.value)} />
      )}
      <TextInput id={NAME_ID} label="Name" value={name} maxLength={100} error={errors[NAME_ID]} onChange={(event) => setName(event.target.value)} />
      <CoversField scope={scope} covers={covers} onChange={setCovers} />
    </FormDialog>
  )
}

/** The {input, expected} object of an uploaded golden file; null when the text is not one JSON object (null, a list, a number). */
export function goldenFileContent(text: string): { readonly input?: unknown; readonly expected?: unknown } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null
}

/** Upload a golden dataset as JSON {input, expected} with its calendar and covers. */
function UploadDialog({ scope, onClose }: { readonly scope: DraftScope; readonly onClose: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [name, setName] = useState('')
  const [calendar, setCalendar] = useState(scope.plan.calendars[0]?.id ?? '')
  const [covers, setCovers] = useState<readonly string[]>([])
  const [file, setFile] = useState<File | null>(null)
  // One key per chosen file: a drop does not fire the form's change event, so FormDialog's key would survive a new file.
  const [attempt, setAttempt] = useState<{ readonly file: File; readonly key: string } | null>(null)
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  function submit() {
    const found = { [NAME_ID]: name.trim() === '' ? 'Enter a name for the golden dataset.' : null, [FILE_ID]: file === null ? 'Choose the JSON file with input and expected.' : null }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0 || file === null) return { items }
    const key = attempt?.file === file ? attempt.key : newIdempotencyKey()
    setAttempt({ file, key })
    return {
      items: [],
      fieldIds: { name: NAME_ID },
      send: async () => {
        const content = goldenFileContent(await file.text())
        if (content === null) {
          const message = `${file.name} is not a JSON object with input and expected.`
          setErrors({ [FILE_ID]: message })
          throw new ApiError(422, 'GOLDEN_INVALID', message)
        }
        try {
          await api.post(`${versionApi(scope.plan.id, scope.version.version)}/golden-datasets`, { name: name.trim(), calendar_id: calendar, covers, input: content.input, expected: content.expected }, { idempotencyKey: key })
        } catch (failure) {
          throw explainedError(failure)
        }
        toast({ message: `Golden dataset ${name.trim()} uploaded.` })
        onClose()
        scope.reload()
      },
    }
  }
  return (
    <FormDialog title="Upload golden dataset" submitLabel="Upload golden dataset" onClose={onClose} onSubmit={submit}>
      <p className={NOTE}>A JSON file with <span className={MONO}>input</span> (engine snapshot and run settings) and <span className={MONO}>expected</span> (lines with amounts in minor units as strings, and their total).</p>
      <TextInput id={NAME_ID} label="Name" value={name} maxLength={100} error={errors[NAME_ID]} onChange={(event) => setName(event.target.value)} />
      <Select label="Calendar" value={calendar} options={scope.plan.calendars.map((c) => ({ value: c.id, label: `${c.name} (${c.market_code})` }))} onChange={(event) => setCalendar(event.target.value)} />
      <FileDropZone id={FILE_ID} label="Golden dataset file" extensions={['.json']} error={errors[FILE_ID]} onFiles={(files) => setFile(files[0] ?? null)} />
      <CoversField scope={scope} covers={covers} onChange={setCovers} />
    </FormDialog>
  )
}

/** Mismatched lines of a failed golden: expected against actual, per payee position and rule. */
function Mismatches({ result, currency }: { readonly result: GoldenResult; readonly currency: Currency | null }) {
  if (result.error !== null) return <p className="font-caption text-caption text-error">{result.error.message}</p>
  if (result.mismatches.length === 0) return null
  const columns: readonly DataTableColumn<Mismatch>[] = [
    { key: 'payee', header: 'Payee position', cell: (m) => <span className={MONO}>{m.payee_position_id}</span> },
    { key: 'rule', header: 'Rule', cell: (m) => <span className={MONO}>{m.rule_key}</span> },
    { key: 'expected', header: 'Expected', align: 'end', cell: (m) => money(m.expected_minor, currency) },
    { key: 'actual', header: 'Calculated', align: 'end', cell: (m) => money(m.actual_minor, currency) },
  ]
  return (
    <details>
      <summary className="cursor-pointer font-caption text-caption text-primary font-semibold">{countLabel(result.mismatches.length, 'mismatched line')}</summary>
      <DataTable caption="Mismatched lines" columns={columns} rows={result.mismatches} rowKey={(m) => `${m.payee_position_id}|${m.rule_key}|${m.origin_type ?? ''}|${m.origin_id ?? ''}`} empty={{ title: 'No mismatch.' }} density="compact" bare />
    </details>
  )
}

/** Pass or fail of the golden's last run against the version as it is now (a run of earlier content does not count). */
function resultBadge(golden: Golden, contentHash: string | null) {
  if (golden.last_result === null) return <StatusBadge state="draft" label="Not run" />
  if (golden.last_result.content_hash !== undefined && golden.last_result.content_hash !== contentHash) return <StatusBadge state="outdated" label="Run on earlier rules" />
  return <StatusBadge state={golden.last_result.status === 'pass' ? 'ready' : 'failed'} label={golden.last_result.status === 'pass' ? 'Pass' : 'Fail'} />
}

/** Goldens with their last result and mismatches. */
export function GoldenTable({ scope, data, onDelete }: { readonly scope: DraftScope; readonly data: Pick<PlanData, 'markets'>; readonly onDelete?: (golden: Golden) => void }) {
  const calendar = (id: string) => scope.plan.calendars.find((c) => c.id === id)
  const columns: DataTableColumn<Golden>[] = [
    { key: 'name', header: 'Golden dataset', cell: (g) => g.name },
    { key: 'calendar', header: 'Calendar', cell: (g) => calendar(g.calendar_id)?.name ?? '—' },
    { key: 'covers', header: 'Covers', cell: (g) => (g.covers.length === 0 ? '—' : <span className={MONO}>{g.covers.join(', ')}</span>) },
    {
      key: 'result', header: 'Last result', cell: (g) => (
        <div className="flex flex-col gap-1 items-start">
          {resultBadge(g, scope.version.content_hash)}
          {g.last_run_at !== null && <span className="font-caption text-caption text-secondary">{formatDateTime(g.last_run_at)}</span>}
          {g.last_result !== null && <Mismatches result={g.last_result} currency={currencyOf(g.calendar_id, scope.plan.calendars, data.markets.data)} />}
        </div>
      ),
    },
  ]
  if (onDelete !== undefined) {
    columns.push({ key: 'actions', header: 'Actions', align: 'end', cell: (g) => <Button size="sm" variant="destructive" aria-label={`Delete golden dataset ${g.name}`} onClick={() => onDelete(g)}>Delete</Button> })
  }
  return <DataTable caption="Golden datasets" columns={columns} rows={scope.version.goldens} rowKey={(g) => g.id} empty={{ title: 'No golden dataset yet.' }} bare />
}

/** SC-04 Golden datasets tab: list, run the suite, upload JSON, freeze from a simulation, delete (draft). */
export function GoldensTab({ scope, data, canSimulate }: { readonly scope: DraftScope; readonly data: Pick<PlanData, 'markets'>; readonly canSimulate: boolean }) {
  const api = useApi()
  const toast = useToast()
  const [dialog, setDialog] = useState<'upload' | 'freeze' | null>(null)
  const [deleting, setDeleting] = useState<Golden | null>(null)
  const uncovered = scope.version.uncovered_extension_rules
  async function remove(golden: Golden) {
    await api.delete(`${versionApi(scope.plan.id, scope.version.version)}/golden-datasets/${golden.id}`)
    toast({ message: `Golden dataset ${golden.name} deleted.` })
    setDeleting(null)
    scope.reload()
  }
  return (
    <div className="flex flex-col gap-space-md">
      {uncovered.length > 0 && <Banner tone="warning" title="Extension rules without a golden case">{uncovered.join(', ')}: submission needs a golden case covering each.</Banner>}
      <section className={CARD} aria-labelledby="goldens-title">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
          <h2 id="goldens-title" className={H2}>Golden datasets</h2>
          <div className="flex flex-wrap items-center gap-space-xs">
            {canSimulate && scope.version.goldens.length > 0 && <RunSuiteButton scope={scope} />}
            {scope.canEdit && <Button icon="upload_file" onClick={() => setDialog('upload')}>Upload JSON</Button>}
            {scope.canEdit && <Button icon="ac_unit" onClick={() => setDialog('freeze')}>Freeze from simulation</Button>}
          </div>
        </div>
        <p className={NOTE}>Each golden case is run line by line at submission and again at scheduling; a mismatch blocks both.</p>
        <GoldenTable scope={scope} data={data} onDelete={scope.canEdit ? setDeleting : undefined} />
      </section>
      {dialog === 'upload' && <UploadDialog scope={scope} onClose={() => setDialog(null)} />}
      {dialog === 'freeze' && <FreezeDialog scope={scope} onClose={() => setDialog(null)} />}
      <ConfirmDialog open={deleting !== null} title={`Delete golden dataset ${deleting?.name ?? ''}`} consequence="The golden case is removed from this draft; rules it covered need another golden case before submission."
        confirmLabel="Delete golden dataset" destructive onConfirm={() => remove(deleting!)} onCancel={() => setDeleting(null)} />
    </div>
  )
}

