'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { RadioGroup, TextInput } from '../../components/form-field'
import { ConfirmDialog } from '../../components/modal'
import { useToast } from '../../components/toast'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { versionApi } from './format'
import type { DraftScope } from './rules-tab'
import type { Transition } from './types'
import { CARD, H2, ifMatch, MONO, NOTE, reloadedIfStale } from './ui'

const STATE_ITEM = /^(title|paid_as|carry|counter|one_time|banked)\.([a-z0-9_]+|\*)$/
export const RULE_LABELS = { carry: 'Carry the value over', map: 'Map ranks', reset: 'Reset' } as const
const RULE_HELP = {
  carry: 'Positions keep the value they had under the previous version.',
  map: 'Ranks of the previous version become ranks of this one.',
  reset: 'The value starts again; give the reason.',
} as const

type Rule = keyof typeof RULE_LABELS
interface MapRow { readonly from: string; readonly to: string }

/** PUT …/transitions/:stateItem (If-Match): how a state item of the previous version enters this one (FR-PLN-008). */
function TransitionDialog({ scope, initial, onClose }: { readonly scope: DraftScope; readonly initial: Transition | { readonly state_item: string }; readonly onClose: () => void }) {
  const api = useApi()
  const toast = useToast()
  const existing = 'rule' in initial ? initial : null
  const [item, setItem] = useState(initial.state_item)
  const [rule, setRule] = useState<Rule>(existing?.rule ?? 'carry')
  const [rows, setRows] = useState<readonly MapRow[]>(existing?.map.length ? existing.map : [{ from: '', to: '' }])
  const [reason, setReason] = useState(existing?.reason ?? '')
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const setRow = (index: number, field: keyof MapRow, value: string) => setRows(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  function submit() {
    const found: Record<string, string> = {}
    if (!STATE_ITEM.test(item)) found['transition-item'] = 'Enter a state item such as title.main, carry.pv or counter.*.'
    if (rule === 'reset' && reason.trim() === '') found['transition-reason'] = 'Enter why the value is reset.'
    const map = rows.filter((row) => row.from.trim() !== '' || row.to.trim() !== '')
    if (rule === 'map' && (map.length === 0 || map.some((row) => row.from.trim() === '' || row.to.trim() === ''))) found['transition-map-0-from'] = 'Enter every mapping with both ranks.'
    setErrors(found)
    const items = Object.entries(found).map(([fieldId, message]) => ({ fieldId, message }))
    if (items.length > 0) return { items }
    return {
      items: [],
      fieldIds: { reason: 'transition-reason', rule: 'transition-rule', ...Object.fromEntries(map.map((_, i) => [`map[${i}].to`, `transition-map-${i}-to`])) },
      send: async () => {
        const body = { rule, map: rule === 'map' ? map.map((row) => ({ from: row.from.trim(), to: row.to.trim() })) : [], reason: reason.trim() === '' ? null : reason.trim() }
        try {
          await api.put(`${versionApi(scope.plan.id, scope.version.version)}/transitions/${item}`, body, { headers: ifMatch(scope.version) })
        } catch (error) {
          throw reloadedIfStale(error, scope.reload)
        }
        toast({ message: `Transition for ${item} saved.` })
        onClose()
        scope.reload()
      },
    }
  }
  return (
    <FormDialog title={existing === null ? 'Declare transition' : `Change transition ${existing.state_item}`} submitLabel="Save transition" onClose={onClose} onSubmit={submit}>
      <TextInput id="transition-item" label="State item" value={item} readOnly={existing !== null} error={errors['transition-item']}
        helper="title.<ladder>, paid_as.<ladder>, carry.<key>, counter.<key>, one_time.<key> or banked.<key>; .* covers every item of that kind." onChange={(event) => setItem(event.target.value)} />
      <RadioGroup legend="Transition" name="transition-rule" value={rule} onChange={(value) => setRule(value as Rule)}
        options={(Object.keys(RULE_LABELS) as Rule[]).map((value) => ({ value, label: RULE_LABELS[value], helper: RULE_HELP[value] }))} />
      {rule === 'map' && (
        <fieldset className="flex flex-col gap-space-sm">
          <legend className="font-caption text-caption uppercase tracking-wider text-secondary font-medium mb-space-xs">Rank mappings</legend>
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-space-sm items-end">
              <TextInput id={`transition-map-${index}-from`} label={`Rank before (${index + 1})`} value={row.from} error={index === 0 ? errors['transition-map-0-from'] : undefined} onChange={(event) => setRow(index, 'from', event.target.value)} />
              <TextInput id={`transition-map-${index}-to`} label={`Rank after (${index + 1})`} value={row.to} onChange={(event) => setRow(index, 'to', event.target.value)} />
              <Button aria-label={`Remove mapping ${index + 1}`} icon="close" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove</Button>
            </div>
          ))}
          <Button icon="add" className="self-start" onClick={() => setRows([...rows, { from: '', to: '' }])}>Add mapping</Button>
        </fieldset>
      )}
      <TextAreaField id="transition-reason" label="Reason" optional={rule !== 'reset'} value={reason} error={errors['transition-reason']} onChange={setReason} />
    </FormDialog>
  )
}

/** SC-04 Transitions tab: the declared transitions and the state items of the previous version still missing one. */
export function TransitionsTab({ scope }: { readonly scope: DraftScope }) {
  const api = useApi()
  const toast = useToast()
  const [editing, setEditing] = useState<Transition | { readonly state_item: string } | null>(null)
  const [deleting, setDeleting] = useState<Transition | null>(null)
  const { version } = scope
  const columns: DataTableColumn<Transition>[] = [
    { key: 'item', header: 'State item', cell: (t) => <span className={MONO}>{t.state_item}</span> },
    { key: 'rule', header: 'Transition', cell: (t) => RULE_LABELS[t.rule] },
    { key: 'map', header: 'Mappings', cell: (t) => (t.map.length === 0 ? '—' : t.map.map((m) => `${m.from} → ${m.to}`).join(', ')) },
    { key: 'reason', header: 'Reason', cell: (t) => t.reason ?? '—' },
  ]
  if (scope.canEdit) {
    columns.push({
      key: 'actions', header: 'Actions', align: 'end', cell: (t) => (
        <span className="inline-flex gap-space-xs">
          <Button size="sm" aria-label={`Change transition ${t.state_item}`} onClick={() => setEditing(t)}>Change</Button>
          <Button size="sm" variant="destructive" aria-label={`Delete transition ${t.state_item}`} onClick={() => setDeleting(t)}>Delete</Button>
        </span>
      ),
    })
  }
  async function remove(transition: Transition) {
    try {
      await api.delete(`${versionApi(scope.plan.id, version.version)}/transitions/${transition.state_item}`, { headers: ifMatch(version) })
    } catch (error) {
      throw reloadedIfStale(error, scope.reload)
    }
    toast({ message: `Transition for ${transition.state_item} deleted.` })
    setDeleting(null)
    scope.reload()
  }
  return (
    <div className="flex flex-col gap-space-md">
      {version.missing_transitions.length > 0 && (
        <Banner tone="warning" title="State items without a transition">
          <p>Positions carry these items from the version in force; scheduling needs a transition for each.</p>
          <ul className="flex flex-wrap gap-space-xs mt-1">
            {version.missing_transitions.map((item) => (
              <li key={item}>{scope.canEdit ? <Button size="sm" aria-label={`Declare transition for ${item}`} onClick={() => setEditing({ state_item: item })}>{item}</Button> : <span className={MONO}>{item}</span>}</li>
            ))}
          </ul>
        </Banner>
      )}
      <section className={CARD} aria-labelledby="transitions-title">
        <div className="flex items-center justify-between gap-space-sm">
          <h2 id="transitions-title" className={H2}>Transitions from the version in force</h2>
          {scope.canEdit && <Button icon="add" onClick={() => setEditing({ state_item: '' })}>Declare transition</Button>}
        </div>
        <p className={NOTE}>How ranks, carry, counters and one-time flags of positions enter this version at its first run.</p>
        <DataTable caption="Transitions" columns={columns} rows={version.transitions} rowKey={(t) => t.state_item} empty={{ title: 'No transition declared.' }} bare />
      </section>
      {editing !== null && <TransitionDialog scope={scope} initial={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={deleting !== null} title={`Delete transition ${deleting?.state_item ?? ''}`} consequence="The state item enters this version without a declared transition until you declare one again."
        confirmLabel="Delete transition" destructive onConfirm={() => remove(deleting!)} onCancel={() => setDeleting(null)} />
    </div>
  )
}
