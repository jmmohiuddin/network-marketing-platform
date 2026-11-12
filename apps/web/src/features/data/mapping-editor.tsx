'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { Dialog } from '../../components/dialog'
import { FormField, SelectField } from '../../components/form-field'
import { PageHeader } from '../../components/page-header'
import { EmptyState, ErrorState, LoadingState, NotAvailable } from '../../components/states'
import { StatusChip } from '../../components/status-chip'
import { useToast } from '../../components/toast'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { dateTime } from './format'
import { MappingForm } from './mapping-form'
import type { BatchState, MappingVersion, SourceValues } from './types'
import { useResource } from '../../lib/use-resource'

// shortcut: the newest 200 versions (one API page) are offered; page through the list if a tenant ever has more.
const VERSIONS_LIMIT = 200
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
    <Dialog open onClose={busy ? () => undefined : onClose} title={`Approve mapping version ${version.version}`} footer={footer}>
      <p>
        Approves version {version.version} as saved; changes not saved on this page are not part of it. An approved version can never be
        edited, and import batches can then be loaded with it. You may be asked for a code from your authenticator app.
      </p>
      <FormField label="Reason" optional>
        {(control) => <textarea {...control} data-autofocus className="input" rows={2} maxLength={REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />}
      </FormField>
      {failure !== null && <Banner tone="danger">{failure}</Banner>}
    </Dialog>
  )
}

const who = (userId: string | null, me: string) => (userId === null ? '—' : userId === me ? 'you' : 'another user')

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

  const failure = [versions.error, mapping.error, batch.error].find((error) => error !== null)
  if (failure !== undefined) {
    return isNotAvailable(failure) ? <NotAvailable /> : <ErrorState message={errorMessage(failure)} onRetry={() => [versions, mapping, batch].forEach((r) => r.reload())} />
  }
  if (versions.loading || mapping.loading || batch.loading) return <LoadingState label="Loading the mapping" />

  const select = (id: string | null) => {
    const query = new URLSearchParams()
    if (id !== null) query.set('version', id)
    if (batchId !== null) query.set('batch', batchId)
    router.replace(`${pathname}?${query.toString()}`)
  }
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

  return (
    <>
      <PageHeader
        title={version === null ? 'Import mapping' : `Import mapping, version ${version.version}`}
        state={version === null ? undefined : <StatusChip state={version.state} />}
        summary="Maps your partner codes to the platform's categories. Saving creates a new version; approved versions never change."
        actions={<>
          {batchId !== null && can('import.manage') && <LinkButton href={`/imports/${batchId}`}>Back to the import batch</LinkButton>}
          {mayApprove && <Button variant="primary" onClick={() => setApproving(true)}>Approve version {version.version}</Button>}
        </>}
      />
      <div className="data-stack">
        {(versions.data ?? []).length > 0 && (
          <div className="data-row">
            <SelectField
              label="Version" value={version?.id ?? ''}
              options={(versions.data ?? []).map((item) => ({ value: item.id, label: `Version ${item.version} (${item.state})` }))}
              onChange={(event) => select(event.target.value)}
            />
          </div>
        )}
        {version !== null && (
          <dl className="data-facts">
            <dt>Saved</dt><dd>{dateTime(version.created_at)} by {who(version.created_by, me.user.id)}</dd>
            <dt>Approved by</dt><dd>{who(version.approved_by, me.user.id)}</dd>
            <dt>Note</dt><dd>{version.notes ?? '—'}</dd>
          </dl>
        )}
        {ownDraft && <Banner tone="info">You saved this version, so another user with approval rights must approve it.</Banner>}
        {batch.data !== null && values === null && <Banner tone="info">The batch was rejected, so it has no partner codes to map.</Banner>}
        {batch.data !== null && values !== null && <p className="data-note">Showing the partner codes of the selected import batch with their row counts.</p>}
      </div>
      <MappingForm
        key={`${version?.id ?? 'none'}:${batchId ?? ''}`}
        version={version} sourceValues={values} latest={latest} editable={editable}
        saveVariant={mayApprove ? 'secondary' : 'primary'} onSaved={saved}
      />
      {approving && version !== null && <ApproveDialog version={version} onClose={() => setApproving(false)} onApproved={approved} />}
    </>
  )
}
