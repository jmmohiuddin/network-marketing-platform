'use client'

import Link from 'next/link'
import { countLabel } from '../../../lib/format'
import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { Button } from '../../../components/button'
import { ConfirmDialog } from '../../../components/dialog'
import { PageHeader } from '../../../components/page-header'
import { LoadingState } from '../../../components/states'
import { StatusChip } from '../../../components/status-chip'
import { Table, type TableColumn } from '../../../components/table'
import { useToast } from '../../../components/toast'
import { errorMessage } from '../../../lib/messages'
import { formatDateTime, jobHealthLabel } from '../format'
import { LoadFailure } from '../page-states'
import { useResource } from '../../../lib/use-resource'
import { useIdempotencyKey } from '../resource'
import type { BreachContact, MarketView, TenantDetail } from '../types'
import { ConsoleNav } from './console-nav'
import { RequestSessionDialog } from './request-session-dialog'

const MARKET_COLUMNS: readonly TableColumn<MarketView>[] = [
  { key: 'code', header: 'Market', cell: (market) => market.code },
  { key: 'currency', header: 'Currency', cell: (market) => `${market.currency} (${market.minor_unit} decimals)` },
  { key: 'zone', header: 'Time zone', cell: (market) => market.time_zone },
  { key: 'languages', header: 'Languages', cell: (market) => market.languages.join(', ') },
  { key: 'pack', header: 'Market pack', cell: (market) => market.market_pack },
  { key: 'state', header: 'State', cell: (market) => <StatusChip state={market.state} /> },
]

const SUPPORTED_STATES = new Set(['implementation', 'live'])

type Step = 'approve' | 'go-live' | 'session'

/** FR-TEN-001 second-person approval: step-up (the API asks) and an Idempotency-Key per opening. */
function ApproveDialog({ tenant, onClose, onDone }: { readonly tenant: TenantDetail; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const idempotencyKey = useIdempotencyKey()
  return (
    <ConfirmDialog
      open
      title="Approve tenant provisioning"
      consequence={`${tenant.legal_name} moves to implementation: its admins get the Tenant admin role and an invitation email. A vendor user other than the one who created the tenant must approve it, with a code from their authenticator app.`}
      confirmLabel="Approve provisioning"
      onCancel={onClose}
      onConfirm={async () => {
        await api.post(`/v1/tenants/${tenant.id}/approve`, undefined, { idempotencyKey })
        toast({ message: `${tenant.legal_name} is in implementation. Its admins have been invited.` })
        onDone()
      }}
    />
  )
}

/** FR-PRV-004 "Vendor ops reads": loaded on request only, because each read is logged in both audit logs. */
function BreachContacts({ tenantId }: { readonly tenantId: string }) {
  const api = useApi()
  const [state, setState] = useState<{ contacts?: readonly BreachContact[] | null; error?: string; busy?: boolean }>({})
  async function load() {
    setState({ busy: true })
    try {
      const { data } = await api.get<{ contacts: readonly BreachContact[] | null }>(`/v1/tenants/${tenantId}/breach-contacts`)
      setState({ contacts: data.contacts })
    } catch (error) {
      setState({ error: errorMessage(error) })
    }
  }
  return (
    <section className="admin-section" aria-labelledby="breach-title">
      <div className="admin-toolbar">
        <h2 id="breach-title" className="admin-section-title">Breach-notification contacts</h2>
        <Button loading={state.busy === true} onClick={load}>Show contacts</Button>
      </div>
      <p className="admin-note">Showing the contacts is recorded in your log and in the tenant’s audit log.</p>
      {state.error !== undefined && <Banner tone="danger">{state.error}</Banner>}
      {state.contacts === null && <Banner tone="warning">The tenant has not recorded a breach contact. Go-live stays blocked until it does.</Banner>}
      {state.contacts !== undefined && state.contacts !== null && (
        <ul className="admin-plain-list">
          {state.contacts.map((contact) => (
            <li key={`${contact.email}|${contact.name}`}>{contact.name}, {contact.role}: {contact.email}, {contact.phone}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Actions({ tenant, onStep }: { readonly tenant: TenantDetail; readonly onStep: (step: Step) => void }) {
  return (
    <>
      {SUPPORTED_STATES.has(tenant.state) && (
        <Button variant={tenant.state === 'live' ? 'primary' : 'secondary'} onClick={() => onStep('session')}>Request support session</Button>
      )}
      {tenant.state === 'provisioning' && <Button variant="primary" onClick={() => onStep('approve')}>Approve provisioning</Button>}
      {tenant.state === 'implementation' && <Button variant="primary" onClick={() => onStep('go-live')}>Go live</Button>}
    </>
  )
}

/** SC-39 tenant: metadata, markets and job health; provisioning approval, go-live, support session request. */
export function TenantDetailPage({ tenantId }: { readonly tenantId: string }) {
  const api = useApi()
  const toast = useToast()
  const tenant = useResource<TenantDetail>(`/v1/tenants/${tenantId}`)
  const [step, setStep] = useState<Step | null>(null)
  const done = () => {
    setStep(null)
    tenant.reload()
  }
  if (tenant.error !== null) return <><ConsoleNav /><LoadFailure error={tenant.error} onRetry={tenant.reload} /></>
  if (tenant.data === null) return <><ConsoleNav /><LoadingState label="Loading the tenant" /></>
  const detail = tenant.data
  return (
    <>
      <ConsoleNav />
      <div className="admin-stack">
        <PageHeader
          title={detail.legal_name}
          state={<StatusChip state={detail.state} />}
          summary={detail.state === 'provisioning'
            ? <>Waiting for a second vendor user to approve. Nothing reaches its admins before that. If nobody else can, invite one under <Link href="/vendor/users">Vendor users</Link>.</>
            : 'Operational metadata only. Business data needs a support session the tenant approves.'}
          actions={<Actions tenant={detail} onStep={setStep} />}
        />
        <dl className="admin-details">
          <dt>Slug</dt><dd>{detail.slug}</dd>
          <dt>Data region</dt><dd>{detail.region}</dd>
          <dt>Isolation tier</dt><dd>{detail.isolation_tier}</dd>
          <dt>Signed DPA document</dt><dd className="admin-mono">{detail.dpa_document_id ?? '—'}</dd>
          <dt>Created</dt><dd>{formatDateTime(detail.created_at)}</dd>
          <dt>Background jobs</dt><dd>{jobHealthLabel(detail.job_health)}</dd>
        </dl>
        <Table caption={countLabel(detail.markets.length, 'market')} columns={MARKET_COLUMNS} rows={detail.markets} rowKey={(market) => market.id} empty={{ title: 'No markets.' }} />
        {detail.state !== 'provisioning' && <BreachContacts tenantId={detail.id} />}
      </div>
      {step === 'approve' && <ApproveDialog tenant={detail} onClose={() => setStep(null)} onDone={done} />}
      {step === 'session' && <RequestSessionDialog tenant={detail} onClose={() => setStep(null)} onRequested={() => setStep(null)} />}
      <ConfirmDialog
        open={step === 'go-live'}
        title="Make tenant live"
        consequence={`${detail.legal_name} becomes live. This is refused while the tenant has no breach-notification contact.`}
        confirmLabel="Go live"
        onCancel={() => setStep(null)}
        onConfirm={async () => {
          await api.post(`/v1/tenants/${detail.id}/go-live`)
          toast({ message: `${detail.legal_name} is live.` })
          done()
        }}
      />
    </>
  )
}
