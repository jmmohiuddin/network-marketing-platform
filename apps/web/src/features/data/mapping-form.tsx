'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { FormField } from '../../components/form-field'
import { Table, type TableColumn } from '../../components/table'
import { errorMessage, fieldErrors } from '../../lib/messages'
import { humanize, integer } from './format'
import { draftFrom, PUBLISHED_STARTER_KIT_CODES, toMappings, unmappedCodes, type Choice, type Draft, type ParticipantChoice } from './mapping-model'
import { PURPOSES, SOURCE_KINDS, type Mappings, type MappingVersion, type SourceValues } from './types'

const NOTES_MAX = 2000

interface Option {
  readonly value: string
  readonly label: string
}

const YES_NO: readonly Option[] = [{ value: '', label: 'Not mapped' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
const vocabulary = (values: readonly string[]): readonly Option[] => [
  { value: '', label: 'Not mapped (loads as unknown)' },
  ...values.map((value) => ({ value, label: value === 'unknown' ? 'Unknown (chosen)' : humanize(value) })),
]
const PURPOSE_OPTIONS = vocabulary(PURPOSES)
const SOURCE_KIND_OPTIONS = vocabulary(SOURCE_KINDS)
const kitOptions = (code: string): readonly Option[] => [
  { value: '', label: PUBLISHED_STARTER_KIT_CODES.has(code) ? 'Published meaning (1 = starter kit)' : 'Not mapped' },
  { value: 'yes', label: 'Starter kit' },
  { value: 'no', label: 'Not a starter kit' },
]

interface ChoiceCellProps {
  readonly label: string
  readonly value: string
  readonly options: readonly Option[]
  readonly editable: boolean
  readonly onChange: (value: string) => void
}

/** A select in edit mode, the chosen label as text when read-only (approved versions, readers). */
function ChoiceCell({ label, value, options, editable, onChange }: ChoiceCellProps) {
  if (!editable) return options.find((option) => option.value === value)?.label ?? value
  return (
    <select className="input select data-cell-select" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

function VocabularyTable({ title, codes, counts, columns }: {
  readonly title: string
  readonly codes: readonly string[]
  readonly counts: Readonly<Record<string, number>> | undefined
  readonly columns: readonly TableColumn<string>[]
}) {
  const rowsOf = (code: string) => (counts !== undefined && Object.hasOwn(counts, code) ? integer(counts[code]!) : '—')
  return (
    <section className="data-section" aria-label={title}>
      <h2>{title}</h2>
      <Table
        caption={`${codes.length} partner code(s)`}
        columns={[
          { key: 'code', header: 'Partner code', cell: (code) => <span className="data-code">{code === '' ? '(empty)' : code}</span> },
          { key: 'rows', header: 'Rows in batch', align: 'end', cell: rowsOf },
          ...columns,
        ]}
        rows={codes}
        rowKey={(code) => code}
        empty={{ title: 'No partner codes of this kind in this version or batch.' }}
      />
    </section>
  )
}

export interface MappingFormProps {
  /** The version shown (null when the tenant has none yet). */
  readonly version: MappingVersion | null
  readonly sourceValues: SourceValues | null
  /** Highest version number; the save sends it as If-Match. */
  readonly latest: number
  /** The user may save versions (mapping.edit). */
  readonly editable: boolean
  readonly saveVariant: 'primary' | 'secondary'
  readonly onSaved: (created: MappingVersion) => void
}

/** SC-25 mapping table per vocabulary; saving always creates the next version as a draft (PUT /v1/import-mappings). */
export function MappingForm({ version, sourceValues, latest, editable: mayEdit, saveVariant, onSaved }: MappingFormProps) {
  const api = useApi()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(version?.mappings ?? null, sourceValues))
  // An approved version is shown read-only; editing it starts the next version from its content.
  const [startedDraft, setStartedDraft] = useState(false)
  const editable = mayEdit && (version?.state !== 'approved' || startedDraft)
  const [notes, setNotes] = useState('')
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [busy, setBusy] = useState(false)

  function set<V extends keyof Draft>(vocab: V, code: string, value: Draft[V][string]) {
    setDraft((current) => ({ ...current, [vocab]: { ...current[vocab], [code]: value } }))
  }
  const setFlag = (code: string, flag: keyof ParticipantChoice, value: string) =>
    set('participant_types', code, { ...draft.participant_types[code]!, [flag]: value as Choice })

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const { mappings, problems } = toMappings(draft)
    if (problems.length > 0) {
      setSummary(problems.map((message) => ({ message })))
      return
    }
    setBusy(true)
    try {
      const body: { mappings: Mappings; notes?: string } = notes.trim() === '' ? { mappings } : { mappings, notes: notes.trim() }
      const { data } = await api.put<MappingVersion>('/v1/import-mappings', body, { headers: { 'If-Match': `"${latest}"` } })
      onSaved(data)
    } catch (error) {
      const issues = Object.entries(fieldErrors(error)).map(([path, message]) => ({ message: `${path}: ${message}` }))
      setSummary(issues.length > 0 ? issues : [{ message: errorMessage(error) }])
      setBusy(false)
    }
  }

  const cell = (label: string, value: string, options: readonly Option[], onChange: (value: string) => void): ReactNode =>
    <ChoiceCell label={label} value={value} options={options} editable={editable} onChange={onChange} />
  const unmapped = unmappedCodes(draft)
  const codes = (record: object) => Object.keys(record).sort()

  return (
    <form className="data-stack" onSubmit={save} noValidate>
      <ErrorSummary items={summary} />
      {mayEdit && !editable && version !== null && (
        <div className="data-row">
          <p className="data-note">Version {version.version} is approved and cannot change.</p>
          <Button variant={saveVariant} onClick={() => setStartedDraft(true)}>Start a new draft from version {version.version}</Button>
        </div>
      )}
      {(unmapped.unknown.length > 0 || unmapped.blocking.length > 0) && (
        <Banner tone="warning" title={`${unmapped.unknown.length + unmapped.blocking.length} partner code(s) are not mapped`}>
          {unmapped.unknown.length > 0 && <p>Order purposes and payout source kinds left unmapped load as unknown and are counted in the data-quality report: <span className="data-code">{unmapped.unknown.join(', ')}</span>.</p>}
          {unmapped.blocking.length > 0 && <p>Participant types and starter-kit codes have no safe default: a batch that uses these cannot be loaded until they are mapped: <span className="data-code">{unmapped.blocking.join(', ')}</span>.</p>}
        </Banner>
      )}
      <VocabularyTable
        title="Participant types" codes={codes(draft.participant_types)} counts={sourceValues?.participant_types}
        columns={[
          { key: 'earn', header: 'Can earn?', cell: (code) => cell(`Can earn: ${code}`, draft.participant_types[code]!.can_earn, YES_NO, (value) => setFlag(code, 'can_earn', value)) },
          { key: 'customer', header: 'Counts as end customer?', cell: (code) => cell(`Counts as end customer: ${code}`, draft.participant_types[code]!.counts_as_end_customer, YES_NO, (value) => setFlag(code, 'counts_as_end_customer', value)) },
        ]}
      />
      <VocabularyTable
        title="Order purposes" codes={codes(draft.purposes)} counts={sourceValues?.purposes}
        columns={[{ key: 'purpose', header: 'Purpose', cell: (code) => cell(`Purpose: ${code}`, draft.purposes[code]!, PURPOSE_OPTIONS, (value) => set('purposes', code, value as Draft['purposes'][string])) }]}
      />
      <VocabularyTable
        title="Payout source kinds" codes={codes(draft.source_kinds)} counts={sourceValues?.source_kinds}
        columns={[{ key: 'kind', header: 'Source kind', cell: (code) => cell(`Source kind: ${code}`, draft.source_kinds[code]!, SOURCE_KIND_OPTIONS, (value) => set('source_kinds', code, value as Draft['source_kinds'][string])) }]}
      />
      <VocabularyTable
        title="Starter-kit codes" codes={codes(draft.starter_kits)} counts={sourceValues?.starter_kits}
        columns={[{ key: 'kit', header: 'Starter kit', cell: (code) => cell(`Starter kit: ${code}`, draft.starter_kits[code]!, kitOptions(code), (value) => set('starter_kits', code, value as Choice)) }]}
      />
      {editable && (
        <section className="data-section" aria-label="Save">
          <FormField label="Note for this version" optional helper="Why the codes are mapped this way; kept with the version.">
            {(control) => <textarea {...control} className="input" rows={3} maxLength={NOTES_MAX} value={notes} onChange={(event) => setNotes(event.target.value)} />}
          </FormField>
          <p className="data-note">
            Saving creates version {latest + 1} as a draft; no saved version changes. Snapshots made with an earlier mapping version are marked Outdated, and their figures stay as they were.
          </p>
          <div className="form-actions">
            <Button type="submit" variant={saveVariant} loading={busy}>Save draft</Button>
          </div>
        </section>
      )}
    </form>
  )
}
