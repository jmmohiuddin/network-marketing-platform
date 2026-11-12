'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { useSession } from '../../../lib/session'
import { Button } from '../../../components/button'
import { Checkbox, SelectField, TextField } from '../../../components/form-field'
import { Table, type TableColumn } from '../../../components/table'
import { useToast } from '../../../components/toast'
import { requiredError } from '../../../lib/validation'
import { permissionLabel } from '../format'
import { FormDialog } from '../form-dialog'
import type { Resource } from '../../../lib/use-resource'
import { tableError } from '../resource'
import type { RoleView } from '../types'

const NAME_ID = 'role-name'
const NAME_MAX_LENGTH = 100

/** A row of the permission matrix: what each role column holds for it. */
interface MatrixRow {
  readonly key: string
  readonly label: string
  readonly holds: (role: RoleView) => boolean
}

/** Permission matrix (UI-04): capability rows by role columns; extra rows for the MFA and second-admin rules. */
function matrixOf(roles: readonly RoleView[], catalogue: readonly string[]): { columns: TableColumn<MatrixRow>[]; rows: MatrixRow[] } {
  const rows: MatrixRow[] = [
    ...catalogue.map((permission) => ({ key: permission, label: permissionLabel(permission), holds: (role: RoleView) => role.permissions.includes(permission) })),
    { key: 'mfa', label: 'Needs authenticator app', holds: (role) => role.mfa_required },
    { key: 'second', label: 'Granting needs a second admin', holds: (role) => role.privileged },
  ]
  const columns: TableColumn<MatrixRow>[] = [
    { key: 'capability', header: 'Capability', cell: (row) => row.label },
    ...roles.map((role) => ({
      key: role.id,
      header: role.is_base ? `${role.name} (base role)` : role.name,
      cell: (row: MatrixRow) => (row.holds(role) ? 'Yes' : 'No'),
    })),
  ]
  return { columns, rows }
}

/** Permissions a new role adds to and removes from the role it starts from (shown before it is created). */
export function permissionDiff(source: readonly string[], chosen: ReadonlySet<string>): { added: string[]; removed: string[] } {
  return { added: [...chosen].filter((permission) => !source.includes(permission)), removed: source.filter((permission) => !chosen.has(permission)) }
}

interface CreateRoleDialogProps {
  readonly roles: readonly RoleView[]
  readonly catalogue: readonly string[]
  readonly onClose: () => void
  readonly onCreated: () => void
}

function RoleDiff({ source, chosen }: { readonly source: RoleView; readonly chosen: ReadonlySet<string> }) {
  const { added, removed } = permissionDiff(source.permissions, chosen)
  const list = (items: readonly string[]) => items.map(permissionLabel).join(', ')
  return (
    <div className="admin-note" role="status">
      {added.length === 0 && removed.length === 0
        ? `Same permissions as ${source.name}.`
        : <>Changes from {source.name}: {added.length > 0 && <>adds {list(added)}. </>}{removed.length > 0 && <>removes {list(removed)}.</>}</>}
    </div>
  )
}

/** SC-28 role editor: a tenant role, optionally starting from another role's permissions (FR-IAM-003 clone). */
function CreateRoleDialog({ roles, catalogue, onClose, onCreated }: CreateRoleDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [name, setName] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [permissions, setPermissions] = useState<ReadonlySet<string>>(new Set())
  const [mfaRequired, setMfaRequired] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const source = roles.find((role) => role.id === copyFrom)

  function copy(roleId: string) {
    setCopyFrom(roleId)
    const source = roles.find((role) => role.id === roleId)
    if (source !== undefined) setPermissions(new Set(source.permissions))
  }
  function toggle(permission: string, checked: boolean) {
    setPermissions((current) => {
      const next = new Set(current)
      if (checked) next.add(permission)
      else next.delete(permission)
      return next
    })
  }
  function submit(idempotencyKey: string) {
    const found = requiredError('a name for the role', name)
    setNameError(found)
    if (found !== null) return { items: [{ fieldId: NAME_ID, message: found }] }
    const body = { name: name.trim(), permissions: catalogue.filter((permission) => permissions.has(permission)), mfa_required: mfaRequired }
    return {
      items: [],
      fieldIds: { name: NAME_ID },
      send: async () => {
        await api.post('/v1/roles', body, { idempotencyKey })
        toast({ message: `Role ${body.name} created. Assign it from the Users tab.` })
        onCreated()
      },
    }
  }
  return (
    <FormDialog title="Create role" size="lg" submitLabel="Create role" onClose={onClose} onSubmit={submit}>
      <TextField id={NAME_ID} label="Role name" data-autofocus maxLength={NAME_MAX_LENGTH} value={name} error={nameError} onChange={(event) => setName(event.target.value)} />
      <SelectField
        label="Start from the permissions of"
        optional
        placeholder="No role"
        value={copyFrom}
        options={roles.map((role) => ({ value: role.id, label: role.name }))}
        onChange={(event) => copy(event.target.value)}
      />
      <fieldset className="admin-fieldset">
        <legend>Permissions</legend>
        <div className="admin-check-grid">
          {catalogue.map((permission) => (
            <Checkbox
              key={permission}
              label={permissionLabel(permission)}
              checked={permissions.has(permission)}
              onChange={(event) => toggle(permission, event.target.checked)}
            />
          ))}
        </div>
      </fieldset>
      {source !== undefined && <RoleDiff source={source} chosen={permissions} />}
      <Checkbox
        label="Users with this role must use an authenticator app"
        helper="Always required when the role can manage users, settings, vendor access or approvals."
        checked={mfaRequired}
        onChange={(event) => setMfaRequired(event.target.checked)}
      />
      <p className="admin-note">Creating a role grants nothing. Granting a role with admin or approver permissions needs a second admin.</p>
    </FormDialog>
  )
}

/** SC-28 roles tab: the permission matrix of base and tenant roles, and new tenant roles. */
export function RolesTab({ roles, onChanged }: { readonly roles: Resource<readonly RoleView[]>; readonly onChanged: () => void }) {
  const { readOnly } = useSession()
  const [creating, setCreating] = useState(false)
  const catalogue = Array.isArray(roles.meta.permissions) ? roles.meta.permissions.filter((item): item is string => typeof item === 'string') : []
  const rows = roles.data ?? []
  const matrix = matrixOf(rows, catalogue)
  return (
    <div className="admin-section">
      <div className="admin-toolbar">
        <p className="admin-note">Base roles are the same for every tenant and cannot be changed. Start a tenant role from one to adjust it.</p>
        {!readOnly && roles.data !== null && <Button onClick={() => setCreating(true)}>Create role</Button>}
      </div>
      <Table
        caption={`Permission matrix: what each of the ${rows.length} roles may do`}
        columns={matrix.columns}
        rows={matrix.rows}
        rowKey={(row) => row.key}
        loading={roles.loading}
        error={tableError(roles)}
        empty={{ title: 'No roles.' }}
      />
      {creating && (
        <CreateRoleDialog
          roles={rows}
          catalogue={catalogue}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            onChanged()
          }}
        />
      )}
    </div>
  )
}
