'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Button } from '../../../components/button'
import { PaginationBar } from '../../../components/data-table'
import { Icon } from '../../../components/icon'
import { EmptyState, LoadingState } from '../../../components/states'
import { useToast } from '../../../components/toast'
import { useSession } from '../../../lib/session'
import type { Market } from '../../../lib/markets'
import { formatDateTime, marketScopeLabel, personLabel, shortId } from '../format'
import { FormDialog, TextAreaField } from '../form-dialog'
import { useResource } from '../../../lib/use-resource'
import { LoadFailure } from '../page-states'
import type { PagedList } from '../resource'
import { CHIP, MONO, NOTE } from '../ui'
import type { GrantRequest, RoleView, UserView } from '../types'

type Decision = 'approved' | 'rejected'

const REASON_ID = 'grant-decision-reason'

/** A user's name from the loaded page of users, else from GET /v1/users/:id. */
function UserName({ userId, users }: { readonly userId: string; readonly users: ReadonlyMap<string, UserView> }) {
  const known = users.get(userId)
  const fetched = useResource<UserView>(known === undefined ? `/v1/users/${userId}` : null)
  const user = known ?? fetched.data
  if (user !== null) return <>{personLabel(user)}</>
  return <>{fetched.loading ? 'Loading…' : `User ${shortId(userId)}`}</>
}

/**
 * SoD for privileged grants (SECURITY_IAM_TENANCY C-3, C-4): neither the admin who asked nor the grantee decides.
 * The API refuses with SOD_SELF_APPROVAL too; the reason is shown instead of the buttons.
 */
export function selfApprovalReason(request: GrantRequest, userId: string): string | null {
  if (request.requested_by === userId) return 'You asked for this grant. Another admin must decide it.'
  if (request.user_id === userId) return 'This grant is for you. Another admin must decide it.'
  return null
}

interface DecisionDialogProps {
  readonly request: GrantRequest
  readonly decision: Decision
  readonly roleName: string
  /** The requested market scope, in words. */
  readonly scope: string
  readonly onClose: () => void
  readonly onDecided: () => void
}

/** POST /v1/role-grant-requests/:id/decision: step-up (the API asks, ApiProvider prompts), Idempotency-Key. */
function DecisionDialog({ request, decision, roleName, scope, onClose, onDecided }: DecisionDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const approving = decision === 'approved'
  function submit(idempotencyKey: string) {
    return {
      items: [],
      fieldIds: { reason: REASON_ID },
      send: async () => {
        await api.post(`/v1/role-grant-requests/${request.id}/decision`, { decision, reason: reason.trim() === '' ? null : reason.trim() }, { idempotencyKey })
        toast({ message: approving ? `${roleName} is granted now.` : 'The grant request was rejected.' })
        onDecided()
      },
    }
  }
  return (
    <FormDialog
      title={approving ? 'Approve role grant' : 'Reject role grant'}
      submitLabel={approving ? 'Approve grant' : 'Reject grant'}
      submitVariant={approving ? 'primary' : 'destructive-solid'}
      onClose={onClose}
      onSubmit={submit}
    >
      <p>
        {approving
          ? `${roleName} (${scope}) takes effect as soon as you approve. You did not ask for this grant and it is not for you.`
          : `${roleName} is not granted. The admin who asked can ask again.`}
      </p>
      <p className={NOTE}>You will be asked for a code from your authenticator app.</p>
      <TextAreaField id={REASON_ID} label="Reason" optional value={reason} onChange={setReason} />
    </FormDialog>
  )
}

export interface ApprovalsTabProps {
  readonly requests: PagedList<GrantRequest>
  readonly roles: readonly RoleView[]
  /** Names the requested markets by code. */
  readonly markets: readonly Market[]
  readonly users: readonly UserView[]
  readonly onChanged: () => void
}

interface GrantCardProps {
  readonly request: GrantRequest
  readonly roleName: string
  readonly scope: string
  readonly users: ReadonlyMap<string, UserView>
  /** Absent: read-only or not allowed (the reason is shown instead). */
  readonly onDecide?: (decision: Decision) => void
  readonly blocked: string | null
}

/** sc_28 "Privileged grant pending" inspector card: header strip, who asked, the grant, decision buttons. */
function GrantCard({ request, roleName, scope, users, onDecide, blocked }: GrantCardProps) {
  const { me } = useSession()
  const titleId = `grant-${request.id}`
  return (
    <li aria-labelledby={titleId} className="bg-surface-container-lowest rounded shadow-sm overflow-hidden flex flex-col">
      <div className="p-space-md bg-surface-container-high flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs min-w-0">
          <Icon name="how_to_reg" size={20} className="text-error" />
          <div className="flex flex-col min-w-0">
            <h2 id={titleId} className="font-section-heading text-section-heading text-on-surface leading-tight">Privileged grant pending</h2>
            <span className={`${MONO} text-secondary`}>Request {shortId(request.id)}</span>
          </div>
        </div>
        <span className="px-space-xs py-0.5 rounded font-caption text-caption font-semibold bg-error-container text-on-error-container uppercase tracking-wider whitespace-nowrap">Second admin</span>
      </div>
      <div className="p-space-md flex flex-col gap-space-md flex-1">
        <div className="p-space-sm bg-surface-container-low rounded flex items-start gap-space-xs">
          <Icon name="info" size={16} className="text-secondary mt-0.5" />
          <p className="font-body-sm text-body-sm text-secondary">
            Asked by {request.requested_by === me.user.id ? 'you' : <UserName userId={request.requested_by} users={users} />} on <span className={`${MONO} text-on-surface`}>{formatDateTime(request.created_at)}</span>.
          </p>
        </div>
        <div className="bg-surface-container rounded p-space-sm flex flex-col gap-space-xs">
          <span className="font-caption text-caption text-secondary uppercase tracking-wider font-semibold">Grant for</span>
          <span className="font-body-sm text-body-sm font-semibold text-on-surface"><UserName userId={request.user_id} users={users} /></span>
          <div className="pt-space-xs border-t border-surface-variant flex flex-col gap-1 font-body-sm text-body-sm">
            <div className="flex items-center justify-between gap-space-sm">
              <span className="text-secondary">Role</span>
              <span className={CHIP}>{roleName}</span>
            </div>
            <div className="flex items-center justify-between gap-space-sm">
              <span className="text-secondary">Market scope</span>
              <span className="text-on-surface font-medium">{scope}</span>
            </div>
          </div>
        </div>
        {blocked !== null && <p className={NOTE}>{blocked}</p>}
        {onDecide !== undefined && (
          <div className="mt-auto flex flex-col gap-space-xs">
            <Button icon="verified_user" className="w-full" aria-label={`Approve ${roleName} grant`} onClick={() => onDecide('approved')}>Approve</Button>
            <Button variant="destructive" icon="cancel" className="w-full" aria-label={`Reject ${roleName} grant`} onClick={() => onDecide('rejected')}>Reject</Button>
          </div>
        )}
      </div>
    </li>
  )
}

/** SC-28 pending approvals: privileged grants waiting for a second admin (AC-36.1), one sc_28 inspector card each. */
export function ApprovalsTab({ requests, roles, markets, users, onChanged }: ApprovalsTabProps) {
  const { me, readOnly } = useSession()
  const [deciding, setDeciding] = useState<{ request: GrantRequest; decision: Decision } | null>(null)
  const roleNames = new Map(roles.map((role) => [role.id, role.name]))
  const userMap = new Map(users.map((user) => [user.id, user]))
  const roleOf = (request: GrantRequest) => roleNames.get(request.role_id) ?? 'Role'
  if (requests.error !== null) return <LoadFailure error={requests.error} onRetry={requests.reload} section />
  if (requests.loading) return <LoadingState label="Loading grants waiting for a decision" />
  if (requests.rows.length === 0) return <EmptyState title="No grants are waiting for a decision." />
  const { pagination } = requests
  return (
    <>
      <p className={`${NOTE} mb-space-sm`}>Grants of admin and approver roles take effect only after a second admin approves them.</p>
      <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-md">
        {requests.rows.map((request) => {
          const blocked = readOnly ? null : selfApprovalReason(request, me.user.id)
          return (
            <GrantCard
              key={request.id}
              request={request}
              roleName={roleOf(request)}
              scope={marketScopeLabel(request.market_ids, markets)}
              users={userMap}
              blocked={blocked}
              onDecide={readOnly || blocked !== null ? undefined : (decision) => setDeciding({ request, decision })}
            />
          )
        })}
      </ul>
      {(pagination.hasPrevious || pagination.hasNext) && <div className="mt-space-md rounded overflow-hidden"><PaginationBar label="Pages of grants waiting for a decision" pagination={pagination} /></div>}
      {deciding !== null && (
        <DecisionDialog
          request={deciding.request}
          decision={deciding.decision}
          roleName={roleOf(deciding.request)}
          scope={marketScopeLabel(deciding.request.market_ids, markets)}
          onClose={() => setDeciding(null)}
          onDecided={() => {
            setDeciding(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}
