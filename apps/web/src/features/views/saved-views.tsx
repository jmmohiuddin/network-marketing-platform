'use client'

import { useEffect, useRef, useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Checkbox, Select, TextInput } from '../../components/form-field'
import { ConfirmDialog } from '../../components/modal'
import { RowMenu, type RowMenuItem } from '../../components/row-menu'
import { useToast } from '../../components/toast'
import { isApiError } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { FormDialog } from '../admin/form-dialog'
import { LoadFailure } from '../admin/page-states'

// FR-RPT-002 saved views (PLAN B6 2.4), one UI for every list that has them (orders, ledger entries).

export type ListName = 'orders' | 'ledger_entries'

/** What a view stores: the list's API filters, its visible columns (registry keys, in order) and its sort. */
export interface ViewState {
  readonly filters: Readonly<Record<string, unknown>>
  readonly columns: readonly string[]
  readonly sort: string
}

/** GET /v1/saved-views rows: own views first, then views shared to a role the caller holds. */
export interface SavedView extends ViewState {
  readonly id: string
  readonly list: ListName
  readonly name: string
  readonly is_default: boolean
  readonly shared_role: { readonly id: string; readonly name: string } | null
  readonly owner: { readonly id: string; readonly display_name: string | null }
  readonly mine: boolean
}

const PATH = '/v1/saved-views'
const NAME_ID = 'view-name'
const NAME_MAX = 100
const ROLE_ID = 'view-role'
const ROLE_HELPER = 'Holders of the role can apply the view; only you can change it. The role must be able to read this list.'

type Dialog = { readonly kind: 'save' } | { readonly kind: 'rename' | 'share' | 'delete'; readonly view: SavedView }

/** The PUT body of a view with some fields changed. */
const bodyOf = (view: SavedView, changes: Partial<{ name: string; is_default: boolean; shared_role_id: string | null }>) => ({
  list: view.list, name: view.name, filters: view.filters, columns: view.columns, sort: view.sort, is_default: view.is_default,
  shared_role_id: view.shared_role?.id ?? null, ...changes,
})

/** The roles the user holds (once each): a view is shared within one of them. */
function useRoleOptions() {
  const { me } = useSession()
  const roles = new Map(me.roles.map((role) => [role.role_id, role.name]))
  return [{ value: '', label: 'Not shared' }, ...[...roles].map(([value, label]) => ({ value, label }))]
}

/** Runs a save; a 422 ROLE_NOT_SHAREABLE (the role cannot read the list; /v1/me roles carry no permissions to filter by) also marks the role field. */
async function checkingRole(save: () => Promise<void>, setRoleError: (message: string | null) => void) {
  setRoleError(null)
  try {
    await save()
  } catch (error) {
    if (isApiError(error, 'ROLE_NOT_SHAREABLE')) setRoleError(errorMessage(error))
    throw error
  }
}

function RoleSelect({ value, error, onChange }: { readonly value: string; readonly error: string | null; readonly onChange: (role: string) => void }) {
  const roles = useRoleOptions()
  return <Select id={ROLE_ID} label="Share with a role" helper={ROLE_HELPER} error={error} value={value} options={roles} onChange={(event) => onChange(event.target.value)} />
}

/** Save as (name, default, share) and Rename: one dialog, PUT for an existing view, POST otherwise. */
function ViewDialog({ list, current, view, onClose, onSaved }: {
  readonly list: ListName
  readonly current: ViewState
  readonly view?: SavedView
  readonly onClose: () => void
  readonly onSaved: (view: SavedView) => void
}) {
  const api = useApi()
  const [name, setName] = useState(view?.name ?? '')
  const [isDefault, setDefault] = useState(false)
  const [role, setRole] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [roleError, setRoleError] = useState<string | null>(null)
  return (
    <FormDialog title={view === undefined ? 'Save view' : `Rename ${view.name}`} submitLabel={view === undefined ? 'Save view' : 'Rename view'} onClose={onClose}
      onSubmit={(idempotencyKey) => {
        const problem = requiredError('a name for the view', name) ?? (name.trim().length > NAME_MAX ? `Use at most ${NAME_MAX} characters.` : null)
        setError(problem)
        if (problem !== null) return { items: [{ fieldId: NAME_ID, message: problem }] }
        return {
          items: [],
          fieldIds: { name: NAME_ID },
          send: () => checkingRole(async () => {
            const saved = view === undefined
              ? await api.post<SavedView>(PATH, { list, name: name.trim(), ...current, is_default: isDefault, shared_role_id: role === '' ? null : role }, { idempotencyKey })
              : await api.put<SavedView>(`${PATH}/${view.id}`, bodyOf(view, { name: name.trim() }))
            onSaved(saved.data)
          }, setRoleError),
        }
      }}>
      <TextInput id={NAME_ID} label="Name" value={name} error={error} maxLength={NAME_MAX} onChange={(event) => setName(event.target.value)} />
      {view === undefined && (
        <>
          <p className="font-body-sm text-body-sm text-secondary">The view keeps the filters, columns and sort shown now.</p>
          <Checkbox label="Open the list with this view" checked={isDefault} onChange={(event) => setDefault(event.target.checked)} />
          <RoleSelect value={role} error={roleError} onChange={setRole} />
        </>
      )}
    </FormDialog>
  )
}

function ShareDialog({ view, onClose, onSaved }: { readonly view: SavedView; readonly onClose: () => void; readonly onSaved: (view: SavedView) => void }) {
  const api = useApi()
  const [role, setRole] = useState(view.shared_role?.id ?? '')
  const [roleError, setRoleError] = useState<string | null>(null)
  return (
    <FormDialog title={`Share ${view.name}`} submitLabel="Save sharing" onClose={onClose} onSubmit={() => ({
      items: [],
      send: () => checkingRole(async () => onSaved((await api.put<SavedView>(`${PATH}/${view.id}`, bodyOf(view, { shared_role_id: role === '' ? null : role }))).data), setRoleError),
    })}>
      <RoleSelect value={role} error={roleError} onChange={setRole} />
    </FormDialog>
  )
}

export interface SavedViewsBarProps {
  readonly list: ListName
  /** The filters, columns and sort shown now (what "Save view" keeps). */
  readonly current: ViewState
  /** The view applied (the page keeps it in the URL), or null. */
  readonly activeId: string | null
  /** Applies a view: the page puts its filters, columns and sort in the URL. */
  readonly onApply: (view: SavedView) => void
  /** Apply the user's default view once, when the page opened without list state in the URL. */
  readonly applyDefault: boolean
}

/** sc_31 "Saved views": choose a view to apply; save the current state as a view; manage the applied view if it is yours. */
export function SavedViewsBar({ list, current, activeId, onApply, applyDefault }: SavedViewsBarProps) {
  const api = useApi()
  const toast = useToast()
  const { readOnly } = useSession()
  const views = useResource<SavedView[]>(PATH, { list })
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const defaulted = useRef(false)
  const preferred = views.data?.find((view) => view.mine && view.is_default)
  useEffect(() => {
    if (defaulted.current || views.data === null) return
    defaulted.current = true
    if (applyDefault && preferred !== undefined) onApply(preferred)
  }, [views.data, applyDefault, preferred, onApply])
  if (views.error !== null) return <LoadFailure error={views.error} onRetry={views.reload} section />
  const active = views.data?.find((view) => view.id === activeId)
  const close = () => setDialog(null)
  const saved = (view: SavedView, message: string) => {
    close()
    views.reload()
    toast({ message })
    onApply(view)
  }
  async function toggleDefault(view: SavedView) {
    setBusy(true)
    setProblem(null)
    try {
      const { data } = await api.put<SavedView>(`${PATH}/${view.id}`, bodyOf(view, { is_default: !view.is_default }))
      views.reload()
      toast({ message: data.is_default ? `${view.name} opens the list from now on.` : `${view.name} no longer opens the list.` })
    } catch (error) {
      setProblem(`The view was not changed. ${errorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }
  const label = (view: SavedView) => [
    view.name, view.is_default && view.mine ? 'default' : null,
    view.mine ? (view.shared_role === null ? null : `shared with ${view.shared_role.name}`) : `from ${view.owner.display_name ?? 'a colleague'}`,
  ].filter(Boolean).join(' · ')
  // sc_31 "Saved Views" menu: apply a view, save the current state, and manage the applied view when it is yours.
  const own = (text: string, icon: string, onSelect: () => void): RowMenuItem => ({ label: text, ariaLabel: text, icon, onSelect })
  const items: RowMenuItem[] = [
    ...(views.data ?? []).map((view) => ({ label: label(view), ariaLabel: `Apply ${label(view)}`, icon: view.id === active?.id ? 'check' : 'bookmark', onSelect: () => onApply(view) })),
    ...(readOnly ? [] : [own('Save current view', 'bookmark_add', () => setDialog({ kind: 'save' }))]),
    ...(active === undefined || !active.mine || readOnly ? [] : [
      own(active.is_default ? `Stop opening with ${active.name}` : `Open the list with ${active.name}`, 'star', () => void toggleDefault(active)),
      own(`Share ${active.name} with a role`, 'group', () => setDialog({ kind: 'share', view: active })),
      own(`Rename ${active.name}`, 'edit', () => setDialog({ kind: 'rename', view: active })),
      own(`Delete ${active.name}`, 'delete', () => setDialog({ kind: 'delete', view: active })),
    ]),
  ]
  const status = views.data === null ? 'Loading views' : active !== undefined ? `View: ${active.name}` : views.data.length === 0 ? 'No saved view yet' : 'No view applied'
  return (
    <div className="flex flex-wrap items-center gap-space-xs" data-testid="saved-views">
      {items.length > 0 && <RowMenu label="Saved views" text="Saved views" icon="bookmarks" items={items} busy={busy || views.data === null} />}
      <span className="font-body-sm text-body-sm text-secondary" aria-live="polite">{status}</span>
      {problem !== null && <div className="basis-full"><Banner tone="danger">{problem}</Banner></div>}
      {dialog?.kind === 'save' && <ViewDialog list={list} current={current} onClose={close} onSaved={(view) => saved(view, `View ${view.name} saved.`)} />}
      {dialog?.kind === 'rename' && <ViewDialog list={list} current={current} view={dialog.view} onClose={close} onSaved={(view) => saved(view, `View renamed to ${view.name}.`)} />}
      {dialog?.kind === 'share' && <ShareDialog view={dialog.view} onClose={close} onSaved={(view) => saved(view, view.shared_role === null ? `${view.name} is no longer shared.` : `${view.name} is shared with ${view.shared_role.name}.`)} />}
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        title={dialog?.kind === 'delete' ? `Delete ${dialog.view.name}` : 'Delete view'}
        consequence="The view is removed for you and for the role it is shared with. The list itself does not change."
        confirmLabel="Delete view"
        destructive
        onCancel={close}
        onConfirm={async () => {
          if (dialog?.kind !== 'delete') return
          await api.delete(`${PATH}/${dialog.view.id}`)
          close()
          views.reload()
          toast({ message: `View ${dialog.view.name} deleted.` })
        }}
      />
    </div>
  )
}
