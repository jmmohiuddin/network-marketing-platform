'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { Checkbox, SelectField } from '../../../components/form-field'
import { useToast } from '../../../components/toast'
import type { SummaryItem } from '../../../components/error-summary'
import { marketName, type Market } from '../../../lib/markets'
import { errorMessage } from '../../../lib/messages'
import type { Resource } from '../../../lib/use-resource'
import { personLabel } from '../format'
import { FormDialog } from '../form-dialog'
import type { RoleView, UserView } from '../types'

const ROLE_ID = 'grant-role'
const MARKETS_ID = 'grant-markets'
const ACCEPTED = 202

type Scope = 'all' | 'some'

export interface GrantDialogProps {
  readonly user: UserView
  readonly roles: readonly RoleView[]
  /** GET /v1/markets: the tenant's markets to choose a scope from. */
  readonly markets: Resource<readonly Market[]>
  readonly onClose: () => void
  readonly onGranted: () => void
}

/**
 * SC-28 Assign role (FR-IAM-003): POST /v1/users/:id/role-assignments with a market scope (AC-36.2). The API
 * grants at once (201), or opens a request for a second admin (202) for admin and approver roles and for
 * anything the granter does not hold over those markets (BR-SEC-05, SEC-27).
 */
export function GrantDialog({ user, roles, markets, onClose, onGranted }: GrantDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [roleId, setRoleId] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<{ role?: string | null; markets?: string | null }>({})
  const role = roles.find((candidate) => candidate.id === roleId)
  const who = personLabel(user)

  function submit(idempotencyKey: string) {
    const marketIds = scope === 'all' ? null : (markets.data ?? []).filter((market) => chosen.has(market.id)).map((market) => market.id)
    const found = {
      role: role === undefined ? 'Choose a role.' : null,
      markets: marketIds !== null && marketIds.length === 0 ? 'Choose at least one market, or all markets.' : null,
    }
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
        <fieldset className="admin-fieldset" id={MARKETS_ID} tabIndex={-1} aria-describedby={errors.markets ? `${MARKETS_ID}-error` : undefined}>
          <legend>Markets</legend>
          <p className="admin-note">The user sees data of these markets only.</p>
          {errors.markets && <p id={`${MARKETS_ID}-error`} className="field-error">{errors.markets}</p>}
          {markets.loading && <p className="admin-note">Loading the markets…</p>}
          {markets.error !== null && <p className="field-error">{errorMessage(markets.error)}</p>}
          <div className="admin-check-grid">
            {(markets.data ?? []).map((market) => (
              <Checkbox
                key={market.id}
                label={marketName(market)}
                checked={chosen.has(market.id)}
                onChange={(event) => setChosen((current) => new Set(event.target.checked ? [...current, market.id] : [...current].filter((id) => id !== market.id)))}
              />
            ))}
          </div>
        </fieldset>
      )}
      <p className="admin-note">If you do not hold every permission of the role for the markets chosen, the grant also waits for a second admin.</p>
    </FormDialog>
  )
}
