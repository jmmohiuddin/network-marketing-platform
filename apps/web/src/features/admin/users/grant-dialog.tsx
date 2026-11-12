'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { SelectField } from '../../../components/form-field'
import { useToast } from '../../../components/toast'
import type { SummaryItem } from '../../../components/error-summary'
import { isUuid, personLabel } from '../format'
import { FormDialog, TextAreaField } from '../form-dialog'
import type { RoleView, UserView } from '../types'

const ROLE_ID = 'grant-role'
const MARKETS_ID = 'grant-markets'
const MAX_MARKETS = 100
const MARKET_ID_TEXT_LENGTH = 37 // a uuid and a separator
const ACCEPTED = 202

type Scope = 'all' | 'some'

/** Market ids typed one per line or separated by commas; duplicates removed. */
export function parseMarketIds(text: string): readonly string[] {
  return [...new Set(text.split(/[\s,]+/).filter((id) => id !== ''))]
}

export function marketIdsError(ids: readonly string[]): string | null {
  if (ids.length === 0) return 'Enter at least one market ID, or choose all markets.'
  if (ids.length > MAX_MARKETS) return `Enter at most ${MAX_MARKETS} market IDs.`
  const invalid = ids.find((id) => !isUuid(id))
  return invalid === undefined ? null : `"${invalid}" is not a market ID. Market IDs look like 0b9e6c1a-1f2d-4c3b-9a8e-7d6c5b4a3f21.`
}

export interface GrantDialogProps {
  readonly user: UserView
  readonly roles: readonly RoleView[]
  readonly onClose: () => void
  readonly onGranted: () => void
}

/**
 * SC-28 Assign role (FR-IAM-003): POST /v1/users/:id/role-assignments with a market scope (AC-36.2). The API
 * grants at once (201), or opens a request for a second admin (202) for admin and approver roles and for
 * anything the granter does not hold over those markets (BR-SEC-05, SEC-27).
 */
export function GrantDialog({ user, roles, onClose, onGranted }: GrantDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [roleId, setRoleId] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [marketText, setMarketText] = useState('')
  const [errors, setErrors] = useState<{ role?: string | null; markets?: string | null }>({})
  const role = roles.find((candidate) => candidate.id === roleId)
  const who = personLabel(user)

  function submit(idempotencyKey: string) {
    const marketIds = scope === 'all' ? null : parseMarketIds(marketText)
    const found = { role: role === undefined ? 'Choose a role.' : null, markets: marketIds === null ? null : marketIdsError(marketIds) }
    setErrors(found)
    const items: SummaryItem[] = [
      ...(found.role === null ? [] : [{ fieldId: ROLE_ID, message: found.role }]),
      ...(found.markets === null ? [] : [{ fieldId: MARKETS_ID, message: found.markets }]),
    ]
    if (items.length > 0 || role === undefined) return { items }
    return {
      items,
      fieldIds: { role_id: ROLE_ID, market_ids: MARKETS_ID },
      send: async () => {
        const result = await api.post(`/v1/users/${user.id}/role-assignments`, { role_id: role.id, market_ids: marketIds }, { idempotencyKey })
        toast(result.status === ACCEPTED
          ? { message: `${role.name} for ${who} waits for a second admin. It is listed under Pending approvals.`, tone: 'info' }
          : { message: `${role.name} granted to ${who}.` })
        onGranted()
      },
    }
  }

  return (
    <FormDialog title="Assign role" submitLabel="Assign role" onClose={onClose} onSubmit={submit}>
      <p>Assign a role to {who}.</p>
      <SelectField
        id={ROLE_ID}
        label="Role"
        placeholder="Choose a role"
        data-autofocus
        value={roleId}
        error={errors.role}
        options={roles.map((option) => ({ value: option.id, label: option.is_base ? option.name : `${option.name} (tenant role)` }))}
        onChange={(event) => setRoleId(event.target.value)}
      />
      {role?.privileged === true && (
        <Banner tone="info" title="Needs a second admin">
          {role.name} is an admin or approver role. It takes effect only after another admin approves it.
        </Banner>
      )}
      <fieldset className="admin-fieldset">
        <legend>Market scope</legend>
        <label className="admin-choice">
          <input type="radio" name="grant-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
          All markets of the tenant
        </label>
        <label className="admin-choice">
          <input type="radio" name="grant-scope" checked={scope === 'some'} onChange={() => setScope('some')} />
          Only some markets
        </label>
      </fieldset>
      {scope === 'some' && (
        <TextAreaField
          id={MARKETS_ID}
          label="Market IDs"
          helper="One per line. The user sees data of these markets only."
          maxLength={MAX_MARKETS * MARKET_ID_TEXT_LENGTH}
          value={marketText}
          error={errors.markets}
          onChange={setMarketText}
        />
      )}
      <p className="admin-note">If you do not hold every permission of the role for the markets chosen, the grant also waits for a second admin.</p>
    </FormDialog>
  )
}
