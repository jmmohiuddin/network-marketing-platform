'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { Modal } from '../../components/modal'
import { FormField, Select, TEXTAREA_CLASS } from '../../components/form-field'
import { PageHeader } from '../../components/page-header'
import { EmptyState, ErrorState, LoadingState, NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { personLabel } from '../admin/format'
import type { UserView } from '../admin/types'
import { dateTime } from './format'
import { isDomain, MappingForm, type Domain } from './mapping-form'
import { NOTE, ScopeStrip } from './ui'
import { ApprovalBar } from '../../components/approval-bar'
import type { BatchState, MappingVersion, SourceValues } from './types'
import { useResource } from '../../lib/use-resource'

// shortcut: the newest 200 versions (one API page) are offered; page through the list if a tenant ever has more.
const VERSIONS_LIMIT = 200
// shortcut: names come from the first 200 users (one API page); others show as "another user".
const USERS_LIMIT = 200
const REASON_MAX = 500

interface BatchSourceValues {
  readonly batch_id: string
  readonly state: BatchState
  /** null for a rejected batch. */
  readonly source_values: SourceValues | null
}

function ApproveDialog({ version, onClose, onApproved }: { readonly version: MappingVersion; readonly onClose: () => void; readonly onApproved: () => void }) {
  const api = useApi()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  async function approve() {
    setBusy(true)
    setFailure(null)
    try {
      await api.post(`/v1/import-mappings/${version.id}/approve`, reason.trim() === '' ? {} : { reason: reason.trim() })
      onApproved()
    } catch (error) {
      setFailure(errorMessage(error))
      setBusy(false)
    }
  }
  const footer = (
    <>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="primary" loading={busy} onClick={approve}>Approve version {version.version}</Button>
    </>
  )
  return (
    <Modal open onClose={busy ? () => undefined : onClose} title={`Approve mapping version ${version.version}`} icon="verified_user" footer={footer}>
      <p className="font-body-sm text-body-sm text-on-surface">
        Approves version {version.version} as saved; changes not saved on this page are not part of it. An approved version can never be
        edited, and import batches can then be loaded with it. You may be asked for a code from your authenticator app.
      </p>
      <FormField label="Reason" optional>
        {(control) => <textarea {...control} data-autofocus className={TEXTAREA_CLASS} rows={2} maxLength={REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />}
      </FormField>
      {failure !== null && <Banner tone="danger">{failure}</Banner>}
    </Modal>
  )
}

/** BUG-029: "you", the user's name when GET /v1/users is readable (user.manage), else "another user". */
function who(userId: string | null, me: string, names: ReadonlyMap<string, string>): string {
  if (userId === null) return '—'
  return userId === me ? 'you' : names.get(userId) ?? 'another user'
}

/**
 * SC-25 import mapping: version selector, the mapping of the chosen version (plus the partner codes of
 * ?batch=), save as a new draft (mapping.edit) and approval by someone other than the author (mapping.approve).
 */
export function MappingEditor() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const toast = useToast()
  const { me, can, readOnly } = useSession()
  const batchId = params.get('batch')
  const versions = useResource<MappingVersion[]>('/v1/import-mappings', { limit: VERSIONS_LIMIT })
  const selectedId = params.get('version') ?? versions.data?.[0]?.id ?? null
  const mapping = useResource<MappingVersion>(selectedId === null ? null : `/v1/import-mappings/${selectedId}`)
  const batch = useResource<BatchSourceValues>(batchId === null ? null : `/v1/imports/${batchId}/source-values`)
  const [approving, setApproving] = useState(false)
  // A failed user list only costs the names: it never blocks the mapping.
  const users = useResource<UserView[]>(can('user.manage') ? '/v1/users' : null, { limit: USERS_LIMIT })
  const names = new Map((users.data ?? []).map((user) => [user.id, personLabel(user)]))

  const failure = [versions.error, mapping.error, batch.error].find((error) => error !== null)
  if (failure !== undefined) {
    return isNotAvailable(failure) ? <NotAvailable /> : <ErrorState message={errorMessage(failure)} onRetry={() => [versions, mapping, batch].forEach((r) => r.reload())} />
  }
  if (versions.loading || mapping.loading || batch.loading) return <LoadingState label="Loading the mapping" />

  const domainParam = params.get('domain')
  const domain: Domain = isDomain(domainParam) ? domainParam : 'participant_types'
  const replace = (versionId: string | null, tab: string | null) => {
    const query = new URLSearchParams()
    if (versionId !== null) query.set('version', versionId)
    if (batchId !== null) query.set('batch', batchId)
    if (tab !== null) query.set('domain', tab)
    router.replace(`${pathname}?${query.toString()}`)
  }
  const select = (id: string | null) => replace(id, domainParam)
  const version = mapping.data
  const latest = Number(versions.meta.latest_version ?? 0)
  const editable = !readOnly && can('mapping.edit')
  const mayApprove = !readOnly && can('mapping.approve') && version?.state === 'draft' && version.created_by !== me.user.id
  const ownDraft = !readOnly && can('mapping.approve') && version?.state === 'draft' && version.created_by === me.user.id
  const values = batch.data?.source_values ?? null

  if (version === null && values === null) {
    return (
      <>
        <PageHeader title="Import mapping" summary="Maps your partner codes to the platform's categories." />
        <EmptyState
          title="No mapping version yet. Open a validated import batch and choose Open mapping to map its partner codes."
          action={can('import.manage') ? <LinkButton href="/imports" variant="primary">Open data imports</LinkButton> : undefined}
        />
      </>
    )
  }

  function saved(created: MappingVersion) {
    toast({ message: `Version ${created.version} saved as a draft.`, tone: 'success' })
    select(created.id)
    versions.reload()
  }
  function approved() {
    setApproving(false)
    toast({ message: `Version ${version?.version} approved.`, tone: 'success' })
    versions.reload()
    mapping.reload()
  }

  const draft = version?.state === 'draft' ? version : null
  return (
    <>
      <PageHeader
        title={version === null ? 'Import mapping' : `Import mapping, version ${version.version}`}
        state={version === null ? undefined : <StatusBadge state={version.state} />}
        summary="Maps your partner codes to the platform's categories. Saving creates a new version; approved versions never change."
        actions={batchId !== null && can('import.manage') ? <LinkButton href={`/imports/${batchId}`} icon="arrow_back">Back to the import batch</LinkButton> : undefined}
      />
      <div className="flex flex-wrap items-end gap-space-md">
        {(versions.data ?? []).length > 0 && (
          <div className="min-w-[14rem]">
            <Select
              label="Version" value={version?.id ?? ''}
              options={(versions.data ?? []).map((item) => ({ value: item.id, label: `Version ${item.version} (${item.state})` }))}
              onChange={(event) => select(event.target.value)}
            />
          </div>
        )}
        {version !== null && (
          // Basis 20rem: the strip moves under the Version select on a phone instead of being squeezed beside it (BUG-037).
          <div className="grow basis-80 min-w-0">
            <ScopeStrip items={[['Saved', `${dateTime(version.created_at)} by ${who(version.created_by, me.user.id, names)}`], ['Approved by', who(version.approved_by, me.user.id, names)], ['Note', version.notes ?? '—']]} />
          </div>
        )}
      </div>
      {ownDraft && <Banner tone="info">You saved this version, so another user with approval rights must approve it.</Banner>}
      {batch.data !== null && values === null && <Banner tone="info">The batch was rejected, so it has no partner codes to map.</Banner>}
      {batch.data !== null && values !== null && <p className={NOTE}>Showing the partner codes of the selected import batch with their row counts.</p>}
      <MappingForm
        key={`${version?.id ?? 'none'}:${batchId ?? ''}`}
        version={version} sourceValues={values} latest={latest} editable={editable}
        saveVariant={mayApprove ? 'secondary' : 'primary'} onSaved={saved}
        domain={domain} onDomain={(tab) => replace(version?.id ?? null, tab)}
      />
      {draft !== null && (
        <>
          {/* Room for the fixed approval bar. */}
          <div aria-hidden="true" className="h-12" />
          <ApprovalBar
            preparedBy={`Saved by ${who(draft.created_by, me.user.id, names)}`}
            preparedAt={dateTime(draft.created_at)}
            blockedReason={ownDraft ? 'Another user must approve this version.' : undefined}
            approvers="Approval by a user with approval rights who did not save it"
            actions={mayApprove ? <Button variant="primary" icon="verified_user" onClick={() => setApproving(true)} data-testid="primary-action">Approve version {draft.version}</Button> : undefined}
          />
        </>
      )}
      {approving && version !== null && <ApproveDialog version={version} onClose={() => setApproving(false)} onApproved={approved} />}
    </>
  )
}
