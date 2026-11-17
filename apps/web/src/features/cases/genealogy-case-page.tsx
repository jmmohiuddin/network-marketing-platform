'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { Banner } from '../../components/banner'
import { FOCUS_RING } from '../../components/button'
import { Icon } from '../../components/icon'
import { RadioGroup, Select, TextInput } from '../../components/form-field'
import { PageHeader } from '../../components/page-header'
import { SegmentedControl } from '../../components/segmented-control'
import { LoadingState, NotAvailable } from '../../components/states'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { fromLocalInput } from '../admin/format'
import { CaseForm, type CaseProposal } from './case-form'
import { caseTypeInfo, KIND_LABELS, utcToday, type CaseTypeInfo } from './format'
import { nodeName, ParticipantPicker, PositionPicker } from './pickers'
import { positionPath } from './refs'
import type { ParticipantRow, PositionDetail, TreeKind, TreeNode } from './types'

const SECTION = 'bg-surface-container-lowest border border-outline-variant rounded p-space-md flex flex-col gap-space-md shadow-sm'
const KIND_OPTIONS = [{ value: 'sponsor', label: KIND_LABELS.sponsor }, { value: 'placement', label: KIND_LABELS.placement }]
const MODE_OPTIONS = [{ value: 'change', label: 'Change (from today)', icon: 'event' }, { value: 'correction', label: 'Correction (back-dated)', icon: 'history' }]

type Sc08Tab = 'change' | 'transfer' | 'duplicates'

/** The registered type (always present: the list is static). */
const typeOf = (type: string): CaseTypeInfo => caseTypeInfo(type)!

/** sc_08 tab strip across its two routes: links, since each tab is its own page. */
export function Sc08Nav({ current }: { readonly current: Sc08Tab }) {
  const { can } = useSession()
  const position = useSearchParams().get('position') // a prefilled position (SC-07, SC-09) survives switching forms
  const keep = position === null ? '' : `position=${encodeURIComponent(position)}`
  const tabs = [
    ...(can('case.genealogy.create') ? [
      { id: 'change', href: `/cases/genealogy/new${keep === '' ? '' : `?${keep}`}`, icon: 'account_tree', label: 'Sponsor and placement change' },
      { id: 'transfer', href: `/cases/genealogy/new?tab=transfer${keep === '' ? '' : `&${keep}`}`, icon: 'swap_horiz', label: 'Ownership transfer' },
    ] : []),
    ...(can('case.duplicate.read') ? [{ id: 'duplicates', href: '/cases/duplicates', icon: 'group_remove', label: 'Duplicate investigation' }] : []),
  ]
  return (
    <nav aria-label="Genealogy and duplicate cases" className="px-space-md bg-surface-container-lowest border-b border-outline-variant rounded-t">
      <ul className="flex flex-wrap items-center gap-x-space-lg">
        {tabs.map((tab) => {
          const active = tab.id === current
          return (
            <li key={tab.id}>
              <Link href={tab.href} aria-current={active ? 'page' : undefined}
                className={`py-space-sm font-body-sm text-body-sm border-b-2 flex items-center gap-2 transition-colors ${FOCUS_RING} ${active ? 'font-semibold text-primary border-primary' : 'text-secondary hover:text-on-surface border-transparent'}`}>
                <Icon name={tab.icon} size={18} />
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

const RELATIONSHIP_FIELDS = { proposed_parent_position_id: 'gc-parent', leg: 'gc-leg', effective_from: 'gc-date', valid_from: 'gc-date', 'payload.leg': 'gc-leg', 'payload.effective_from': 'gc-date', 'payload.valid_from': 'gc-date' }

/** Sponsor and placement change or correction (genealogy_change / genealogy_correction, PLAN B2 2.4). */
function RelationshipForm({ initial }: { readonly initial: TreeNode | null }) {
  const [mode, setMode] = useState<'change' | 'correction'>('change')
  const [kind, setKind] = useState<TreeKind>('sponsor')
  const [position, setPosition] = useState<TreeNode | null>(initial)
  const [parent, setParent] = useState<TreeNode | null>(null)
  const [leg, setLeg] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(utcToday)
  const [correctFrom, setCorrectFrom] = useState<'start' | 'custom'>('start')
  const [customAt, setCustomAt] = useState('')
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const detail = useResource<PositionDetail>(position === null ? null : positionPath(position.position_id))
  const width = useResource<{ readonly value: number | null }>('/v1/settings/genealogy.placement_width')
  const current = detail.data?.parents[kind] ?? null
  const legs = kind === 'placement' && typeof width.data?.value === 'number' ? width.data.value : null
  const fromStart = correctFrom === 'start' && current !== null
  // shortcut: cancelling a pending future change (E-GEN-04, a correction at exactly that row's start) is not offered here,
  // because GET /v1/positions/:id names only the current parent; offer the pending row's start once the API exposes it.

  function prepare(): CaseProposal {
    const validFrom = fromStart ? current.valid_from : fromLocalInput(customAt)
    const found: Record<string, string | null> = {
      'gc-position': position === null ? 'Choose the position to move.' : null,
      'gc-parent': parent === null ? 'Choose the proposed parent.' : parent.position_id === position?.position_id ? 'Choose a parent other than the position itself.' : null,
      'gc-date': mode === 'change'
        ? (effectiveFrom === '' || effectiveFrom < utcToday() ? 'Choose today (UTC) or a later date.' : null)
        : (validFrom === null ? 'Enter the date and time the correction applies from.' : !fromStart && new Date(validFrom) > new Date() ? 'A correction applies from now or earlier.' : null),
    }
    setErrors(found)
    const payload = {
      kind, proposed_parent_position_id: parent?.position_id, ...(legs !== null && leg !== '' ? { leg } : {}),
      ...(mode === 'change' ? { effective_from: effectiveFrom } : { valid_from: validFrom }),
    }
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    return { items, subjectType: 'position', subjectId: position?.position_id ?? null, payload }
  }

  const info = typeOf(mode === 'change' ? 'genealogy_change' : 'genealogy_correction')
  return (
    <CaseForm key={info.type} idPrefix="gc" info={info} prepare={prepare} fieldIds={RELATIONSHIP_FIELDS} submitLabel={`Open ${info.label.toLowerCase()} case`}>
      <div className="flex flex-wrap gap-space-md">
        <SegmentedControl label="Effective application" options={MODE_OPTIONS} value={mode} onChange={(value) => setMode(value as 'change' | 'correction')} />
        <SegmentedControl label="Tree" options={KIND_OPTIONS} value={kind} onChange={(value) => setKind(value as TreeKind)} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md bg-surface-container-low p-space-sm rounded border border-outline-variant">
        <PositionPicker id="gc-position" label="Position to move" kind={kind} chosen={position} onChoose={setPosition} error={errors['gc-position']} />
        <PositionPicker id="gc-parent" label="Proposed parent" kind={kind} chosen={parent} onChoose={setParent} error={errors['gc-parent']} />
      </div>
      {position !== null && (
        <p className="font-body-sm text-body-sm text-on-surface-variant" data-testid="current-parent">
          Current {kind} parent: {detail.loading ? 'loading…' : current === null ? 'none (a root)' : `${current.position_ref}${'leg' in current && current.leg !== null ? `, leg ${current.leg}` : ''} since ${formatDateTime(current.valid_from)}`}
          {parent !== null && <> · proposed: {nodeName(parent)}</>}
        </p>
      )}
      {legs !== null && (
        <Select id="gc-leg" label="Leg" optional helper="Leave empty to place without a leg." value={leg}
          options={[{ value: '', label: 'No leg' }, ...Array.from({ length: legs }, (_, index) => ({ value: String(index + 1), label: `Leg ${index + 1}` }))]}
          onChange={(event) => setLeg(event.target.value)} />
      )}
      {mode === 'change' ? (
        <TextInput id="gc-date" type="date" label="Effective from (UTC date)" helper="Today or later; a change never rewrites the past." min={utcToday()} value={effectiveFrom} error={errors['gc-date']} onChange={(event) => setEffectiveFrom(event.target.value)} />
      ) : (
        <div className="flex flex-col gap-space-sm">
          {current !== null && (
            <RadioGroup legend="Correct from" name="gc-correct-from" value={correctFrom} onChange={(value) => setCorrectFrom(value as 'start' | 'custom')}
              options={[
                { value: 'start', label: `When the current parent started (${formatDateTime(current.valid_from)})`, helper: 'The relationship is corrected from its first day.' },
                { value: 'custom', label: 'From another date and time' },
              ]} />
          )}
          {!fromStart && (
            <TextInput id="gc-date" type="datetime-local" label="Correct from (your time)" helper="Now or earlier: a correction back-dates the change." value={customAt} error={errors['gc-date']} onChange={(event) => setCustomAt(event.target.value)} />
          )}
          {fromStart && errors['gc-date'] != null && <p role="alert" className="font-caption text-caption text-error">{errors['gc-date']}</p>}
        </div>
      )}
    </CaseForm>
  )
}

const TRANSFER_FIELDS = { to_participant_id: 'tr-owner', effective_from: 'tr-date', 'payload.to_participant_id': 'tr-owner', 'payload.effective_from': 'tr-date' }

/** Ownership transfer (transfer, PLAN B2 2.4): the position keeps its place, its owner changes. */
function TransferForm({ initial }: { readonly initial: TreeNode | null }) {
  const [position, setPosition] = useState<TreeNode | null>(initial)
  const [owner, setOwner] = useState<ParticipantRow | null>(null)
  const [effectiveFrom, setEffectiveFrom] = useState(utcToday)
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  function prepare(): CaseProposal {
    const found: Record<string, string | null> = {
      'tr-position': position === null ? 'Choose the position to transfer.' : null,
      'tr-owner': owner === null ? 'Choose the new owner.' : null,
      'tr-date': effectiveFrom === '' || effectiveFrom < utcToday() ? 'Choose today (UTC) or a later date.' : null,
    }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    return { items, subjectType: 'position', subjectId: position?.position_id ?? null, payload: { to_participant_id: owner?.id, effective_from: effectiveFrom } }
  }
  return (
    <CaseForm idPrefix="tr" info={typeOf('transfer')} prepare={prepare} fieldIds={TRANSFER_FIELDS} submitLabel="Open ownership transfer case">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md bg-surface-container-low p-space-sm rounded border border-outline-variant">
        <PositionPicker id="tr-position" label="Position to transfer" kind="sponsor" chosen={position} onChoose={setPosition} error={errors['tr-position']} />
        <ParticipantPicker id="tr-owner" label="New owner" chosen={owner} onChoose={setOwner} error={errors['tr-owner']} />
      </div>
      <TextInput id="tr-date" type="date" label="Effective from (UTC date)" helper="Today or later." min={utcToday()} value={effectiveFrom} error={errors['tr-date']} onChange={(event) => setEffectiveFrom(event.target.value)} />
    </CaseForm>
  )
}

/** A position as the search pickers show it. */
const nodeOf = (position: PositionDetail): TreeNode => ({
  position_id: position.id, position_ref: position.position_ref, owner: position.owner, status: position.status, market_code: position.market.code, leg: null,
})

/** ?position=<id> (SC-07 "Request change", SC-09): the form opens with that position chosen; unreadable -> say so, search instead. */
function WithPosition({ id, children }: { readonly id: string | null; readonly children: (initial: TreeNode | null) => ReactNode }) {
  const preset = useResource<PositionDetail>(id === null ? null : positionPath(id))
  if (id === null) return children(null)
  if (preset.data !== null) return children(nodeOf(preset.data))
  if (preset.error === null) return <LoadingState label="Loading the position" />
  return (
    <>
      <Banner tone="warning" title="The linked position could not be loaded">{errorMessage(preset.error)} Search for the position instead.</Banner>
      {children(null)}
    </>
  )
}

/** SC-08 /cases/genealogy/new: file a sponsor/placement change or correction, or an ownership transfer. */
export function GenealogyCasePage() {
  const { can, readOnly } = useSession()
  const params = useSearchParams()
  if (readOnly || !can('case.genealogy.create')) return <NotAvailable />
  const tab = params.get('tab') === 'transfer' ? 'transfer' : 'change'
  return (
    <>
      <PageHeader
        title="New genealogy case"
        breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'New genealogy case' }]}
        summary="A change never rewrites the past; a correction is back-dated. Both need evidence and are decided by a second person."
      />
      <div>
        <Sc08Nav current={tab} />
        <section className={`${SECTION} rounded-t-none border-t-0`} aria-label={tab === 'transfer' ? 'Ownership transfer' : 'Sponsor and placement change'} data-testid="card">
          <WithPosition key={tab} id={params.get('position')}>{(initial) => (tab === 'transfer' ? <TransferForm initial={initial} /> : <RelationshipForm initial={initial} />)}</WithPosition>
        </section>
      </div>
    </>
  )
}
