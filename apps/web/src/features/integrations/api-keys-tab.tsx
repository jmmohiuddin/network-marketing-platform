'use client'

import { useState } from 'react'
import { Button } from '../../components/button'
import { DataTable, PaginationBar, type DataTableColumn } from '../../components/data-table'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { formatDateTime } from '../../lib/format'
import { useSession } from '../../lib/session'
import { LoadFailure } from '../admin/page-states'
import type { PagedList } from '../admin/resource'
import { MONO, NOTE, ROW_ACTIONS } from '../admin/ui'
import { isUsable, keyBadge } from './format'
import { CreateKeyDialog, ReasonDialog, RotateKeyDialog } from './key-dialogs'
import type { ApiKey, IssuedKey, ServiceAccount } from './types'
import { CARD, IconTile, OneTimeSecretDialog, SECTION_HEADING, useFocusAfterAction } from './ui'

export const KEYS_HEADING_ID = 'integrations-keys-heading'
const TIER_NAMES = { standard: 'Standard', high: 'High' } as const
const LOST_KEY = 'If you did not store it, revoke this key and create a new one.'

type KeyAction =
  | { readonly kind: 'create'; readonly account: ServiceAccount }
  | { readonly kind: 'disable'; readonly account: ServiceAccount }
  | { readonly kind: 'rotate' | 'revoke'; readonly key: ApiKey }
  | { readonly kind: 'issued'; readonly issued: IssuedKey; readonly rotated: boolean }

// replaced: keys that already have a successor; the API refuses a second rotation (API_KEY_ALREADY_ROTATED).
function keyColumns(onAction: ((action: KeyAction) => void) | undefined, replaced: ReadonlySet<string>): readonly DataTableColumn<ApiKey>[] {
  return [
    {
      key: 'key', header: 'Key', cell: (key) => (
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-on-surface">{key.name}</span>
          <span className={`${MONO} text-secondary`}>{key.key_prefix}…</span>
        </div>
      ),
    },
    { key: 'scopes', header: 'Scopes', cell: (key) => <span className={MONO}>{key.scopes.join(', ')}</span> },
    { key: 'tier', header: 'Rate limit', cell: (key) => TIER_NAMES[key.rate_tier] },
    { key: 'ip', header: 'IP allow-list', cell: (key) => (key.ip_allow === null ? 'Any address' : <span className={`${MONO} break-all`}>{key.ip_allow.join(', ')}</span>) },
    { key: 'expires', header: 'Expires', cell: (key) => <span className={`${MONO} whitespace-nowrap`}>{key.expires_at === null ? 'Never' : formatDateTime(key.expires_at)}</span> },
    { key: 'used', header: 'Last used', cell: (key) => <span className={`${MONO} whitespace-nowrap`}>{key.last_used_at === null ? 'Never' : formatDateTime(key.last_used_at)}</span> },
    { key: 'status', header: 'Status', cell: (key) => <StatusBadge {...keyBadge(key.status)} /> },
    {
      key: 'actions', header: 'Actions', align: 'end', cell: (key) => onAction === undefined || !isUsable(key) ? null : (
        <div className={ROW_ACTIONS}>
          {!replaced.has(key.id) && <Button size="sm" icon="autorenew" aria-label={`Rotate key ${key.key_prefix}`} onClick={() => onAction({ kind: 'rotate', key })}>Rotate</Button>}
          <Button variant="destructive" size="sm" aria-label={`Revoke key ${key.key_prefix}`} onClick={() => onAction({ kind: 'revoke', key })}>Revoke</Button>
        </div>
      ),
    },
  ]
}

/** sc_13 connector card as a service account: header, purpose, its keys. */
function AccountCard({ account, onAction }: { readonly account: ServiceAccount; readonly onAction?: (action: KeyAction) => void }) {
  const titleId = `service-account-${account.id}`
  const active = account.state === 'active'
  const actions = active ? onAction : undefined
  return (
    <li aria-labelledby={titleId} className={CARD} data-testid="service-account">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs">
        <div className="flex items-center gap-space-sm min-w-0">
          <IconTile name="smart_toy" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-space-xs">
              <h3 id={titleId} className={SECTION_HEADING}>{account.name}</h3>
              <StatusBadge state={active ? 'active' : 'retired'} label={active ? 'Active' : 'Disabled'} />
            </div>
            <p className={NOTE}>{account.purpose}</p>
            <p className={`${MONO} text-secondary mt-0.5`}>Created {formatDateTime(account.created_at)} by {account.created_by.display_name ?? 'a user without a name'}{account.disabled_at === null ? '' : ` · disabled ${formatDateTime(account.disabled_at)}`}</p>
          </div>
        </div>
        {actions !== undefined && (
          <div className="flex items-center gap-1.5 self-start sm:self-center">
            <Button size="sm" icon="add" aria-label={`Create key for ${account.name}`} onClick={() => actions({ kind: 'create', account })}>Create key</Button>
            <Button variant="destructive" size="sm" aria-label={`Disable ${account.name}`} onClick={() => actions({ kind: 'disable', account })}>Disable</Button>
          </div>
        )}
      </div>
      <DataTable
        bare caption={`Keys of ${account.name}`} columns={keyColumns(actions, new Set(account.keys.flatMap((key) => (key.rotated_from_id === null ? [] : [key.rotated_from_id]))))} rows={account.keys} rowKey={(key) => key.id}
        empty={{ title: active ? 'No keys yet. Create one; it is shown once.' : 'No keys.' }}
      />
    </li>
  )
}

/** SC-13 "Public API keys" tab (FR-IAM-006, PLAN B1 2.5): service accounts and their scoped keys. */
export function ApiKeysTab({ accounts, onChanged }: { readonly accounts: PagedList<ServiceAccount>; readonly onChanged: () => void }) {
  const { readOnly } = useSession()
  const toast = useToast()
  const focusAfter = useFocusAfterAction()
  const [action, setAction] = useState<KeyAction | null>(null)
  const close = () => setAction(null)
  const removed = () => {
    setAction(null)
    focusAfter(`#${KEYS_HEADING_ID}`)
    onChanged()
  }
  const issued = (result: IssuedKey, rotated: boolean) => {
    setAction({ kind: 'issued', issued: result, rotated })
    onChanged()
  }
  const { pagination } = accounts
  return (
    <section aria-labelledby={KEYS_HEADING_ID} className="flex flex-col gap-space-md">
      <h2 id={KEYS_HEADING_ID} className={SECTION_HEADING}>Service accounts and keys</h2>
      {accounts.error !== null && <LoadFailure error={accounts.error} onRetry={accounts.reload} section />}
      {accounts.error === null && accounts.loading && <LoadingState label="Loading service accounts" />}
      {accounts.error === null && !accounts.loading && accounts.rows.length === 0 && (
        <EmptyState title="No service accounts yet. Create one for each system that reads your data through the API." />
      )}
      {accounts.rows.length > 0 && (
        <ul className="flex flex-col gap-space-md">
          {accounts.rows.map((account) => <AccountCard key={account.id} account={account} onAction={readOnly ? undefined : setAction} />)}
        </ul>
      )}
      {(pagination.hasPrevious || pagination.hasNext) && <div className="rounded overflow-hidden"><PaginationBar label="Pages of service accounts" pagination={pagination} /></div>}
      {action?.kind === 'create' && <CreateKeyDialog account={action.account} onClose={close} onIssued={(result) => issued(result, false)} />}
      {action?.kind === 'rotate' && <RotateKeyDialog apiKey={action.key} onClose={close} onIssued={(result) => issued(result, true)} />}
      {action?.kind === 'revoke' && (
        <ReasonDialog
          title={`Revoke key ${action.key.key_prefix}`} submitLabel="Revoke key" path={`/v1/api-keys/${action.key.id}/revoke`}
          intro={`${action.key.name} stops working at once; requests with it are refused.`}
          doneMessage={`Key ${action.key.key_prefix} was revoked.`} onClose={close} onDone={removed}
        />
      )}
      {action?.kind === 'disable' && (
        <ReasonDialog
          title={`Disable ${action.account.name}`} submitLabel="Disable service account" path={`/v1/service-accounts/${action.account.id}/disable`}
          intro={`Every key of ${action.account.name} stops working at once and no new key can be created for it.`}
          doneMessage={`${action.account.name} was disabled.`} onClose={close} onDone={removed}
        />
      )}
      {action?.kind === 'issued' && (
        <OneTimeSecretDialog
          title={action.rotated ? 'Key rotated' : 'API key created'} label="API key" value={action.issued.token} lostHint={LOST_KEY}
          onClose={() => {
            setAction(null)
            toast({ message: `Key ${action.issued.key.key_prefix} is ready.` })
          }}
        >
          <p>Send it as <code className={MONO}>Authorization: Bearer &lt;key&gt;</code>. Its scopes: {action.issued.key.scopes.join(', ')}.</p>
        </OneTimeSecretDialog>
      )}
    </section>
  )
}
