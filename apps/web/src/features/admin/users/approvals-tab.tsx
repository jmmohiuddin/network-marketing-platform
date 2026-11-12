'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Button } from '../../../components/button'
import { Table, type TableColumn } from '../../../components/table'
import { useToast } from '../../../components/toast'
import { useSession } from '../../../lib/session'
import { formatDateTime, marketScopeLabel, personLabel, shortId } from '../format'
import { FormDialog, TextAreaField } from '../form-dialog'
import { useResource } from '../../../lib/use-resource'
import { tableError, type PagedList } from '../resource'
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
  readonly onClose: () => void
  readonly onDecided: () => void
}

/** POST /v1/role-grant-requests/:id/decision: step-up (the API asks, ApiProvider prompts), Idempotency-Key. */
function DecisionDialog({ request, decision, roleName, onClose, onDecided }: DecisionDialogProps) {
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
          ? `${roleName} (${marketScopeLabel(request.market_ids)}) takes effect as soon as you approve. You did not ask for this grant and it is not for you.`
          : `${roleName} is not granted. The admin who asked can ask again.`}
      </p>
      <p className="admin-note">You will be asked for a code from your authenticator app.</p>
      <TextAreaField id={REASON_ID} label="Reason" optional value={reason} onChange={setReason} />
    </FormDialog>
  )
}

export interface ApprovalsTabProps {
  readonly requests: PagedList<GrantRequest>
  readonly roles: readonly RoleView[]
  readonly users: readonly UserView[]
  readonly onChanged: () => void
}

/** SC-28 pending approvals: privileged grants waiting for a second admin (AC-36.1). */
export function ApprovalsTab({ requests, roles, users, onChanged }: ApprovalsTabProps) {
  const { me, readOnly } = useSession()
  const [deciding, setDeciding] = useState<{ request: GrantRequest; decision: Decision } | null>(null)
  const roleNames = new Map(roles.map((role) => [role.id, role.name]))
  const userMap = new Map(users.map((user) => [user.id, user]))
  const roleOf = (request: GrantRequest) => roleNames.get(request.role_id) ?? 'Role'
  const columns: readonly TableColumn<GrantRequest>[] = [
    { key: 'user', header: 'For', cell: (request) => <UserName userId={request.user_id} users={userMap} /> },
    { key: 'role', header: 'Role', cell: (request) => `${roleOf(request)} · ${marketScopeLabel(request.market_ids)}` },
    { key: 'by', header: 'Asked by', cell: (request) => (request.requested_by === me.user.id ? 'You' : <UserName userId={request.requested_by} users={userMap} />) },
    { key: 'at', header: 'Asked at', cell: (request) => formatDateTime(request.created_at) },
    {
      key: 'decision',
      header: 'Decision',
      align: 'end',
      cell: (request) => {
        if (readOnly) return null
        const blocked = selfApprovalReason(request, me.user.id)
        if (blocked !== null) return <span className="admin-note">{blocked}</span>
        return (
          <div className="admin-row-actions">
            <Button aria-label={`Approve ${roleOf(request)} grant`} onClick={() => setDeciding({ request, decision: 'approved' })}>Approve</Button>
            <Button variant="destructive" aria-label={`Reject ${roleOf(request)} grant`} onClick={() => setDeciding({ request, decision: 'rejected' })}>Reject</Button>
          </div>
        )
      },
    },
  ]
  return (
    <>
      <Table
        caption="Grants of admin and approver roles take effect only after a second admin approves them."
        columns={columns}
        rows={requests.rows}
        rowKey={(request) => request.id}
        loading={requests.loading}
        error={tableError(requests)}
        empty={{ title: 'No grants are waiting for a decision.' }}
        pagination={requests.pagination}
      />
      {deciding !== null && (
        <DecisionDialog
          request={deciding.request}
          decision={deciding.decision}
          roleName={roleOf(deciding.request)}
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
