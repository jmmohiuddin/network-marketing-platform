'use client'

import Link from 'next/link'
import { countLabel } from '../../../lib/format'
import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { Button } from '../../../components/button'
import { ConfirmDialog } from '../../../components/modal'
import { PageHeader } from '../../../components/page-header'
import { LoadingState } from '../../../components/states'
import { StatusBadge } from '../../../components/status-badge'
import { DataTable, type DataTableColumn } from '../../../components/data-table'
import { useToast } from '../../../components/toast'
import { errorMessage } from '../../../lib/messages'
import { formatDateTime, jobHealthLabel } from '../format'
import { LoadFailure } from '../page-states'
import { useResource } from '../../../lib/use-resource'
import { useIdempotencyKey } from '../resource'
import type { BreachContact, MarketView, TenantDetail } from '../types'
import { MetaGrid, MONO, NOTE, SECTION_CARD, SectionTitle } from '../ui'
import { OffboardingPanel } from './offboarding-panel'
import { RequestSessionDialog } from './request-session-dialog'

const MARKET_COLUMNS: readonly DataTableColumn<MarketView>[] = [
  { key: 'code', header: 'Market', cell: (market) => <span className="font-data-mono-md text-data-mono-md text-primary">{market.code}</span> },
  { key: 'currency', header: 'Currency', cell: (market) => `${market.currency} (${market.minor_unit} decimals)` },
  { key: 'zone', header: 'Time zone', cell: (market) => market.time_zone },
  { key: 'languages', header: 'Languages', cell: (market) => market.languages.join(', ') },
  { key: 'pack', header: 'Market pack', cell: (market) => market.market_pack },
  { key: 'state', header: 'State', cell: (market) => <StatusBadge state={market.state} /> },
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
    <section className={SECTION_CARD} aria-labelledby="breach-title">
      <SectionTitle
        id="breach-title"
        icon="contact_phone"
        title="Breach-notification contacts"
        action={<Button icon="visibility" loading={state.busy === true} onClick={load}>Show contacts</Button>}
      />
      <p className={NOTE}>Showing the contacts is recorded in your log and in the tenant’s audit log.</p>
      {state.error !== undefined && <Banner tone="danger">{state.error}</Banner>}
      {state.contacts === null && <Banner tone="warning">The tenant has not recorded a breach contact. Go-live stays blocked until it does.</Banner>}
      {state.contacts !== undefined && state.contacts !== null && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
          {state.contacts.map((contact) => (
            <li key={`${contact.email}|${contact.name}`} className="p-space-md rounded bg-surface-container-low flex flex-col">
              <span className="font-caption text-caption uppercase tracking-wider text-secondary">{contact.role}</span>
              <span className="font-section-heading text-section-heading text-on-surface">{contact.name}</span>
              <span className={`${MONO} text-primary break-all`}>{contact.email}, {contact.phone}</span>
            </li>
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
        tenant.state === 'live'
          ? <Button variant="primary" icon="vpn_key" data-testid="primary-action" onClick={() => onStep('session')}>Request support session</Button>
          : <Button icon="vpn_key" onClick={() => onStep('session')}>Request support session</Button>
      )}
      {tenant.state === 'provisioning' && <Button variant="primary" icon="verified_user" data-testid="primary-action" onClick={() => onStep('approve')}>Approve provisioning</Button>}
      {tenant.state === 'implementation' && <Button variant="primary" icon="rocket_launch" data-testid="primary-action" onClick={() => onStep('go-live')}>Go live</Button>}
    </>
  )
}

/** SC-39 tenant: metadata, markets and job health; provisioning approval, go-live, support session request, offboarding. */
export function TenantDetailPage({ tenantId }: { readonly tenantId: string }) {
  const api = useApi()
  const toast = useToast()
  const tenant = useResource<TenantDetail>(`/v1/tenants/${tenantId}`)
  const [step, setStep] = useState<Step | null>(null)
  const done = () => {
    setStep(null)
    tenant.reload()
  }
  if (tenant.error !== null) return <LoadFailure error={tenant.error} onRetry={tenant.reload} />
  if (tenant.data === null) return <LoadingState label="Loading the tenant" />
  const detail = tenant.data
  return (
    <>
      <PageHeader
        title={detail.legal_name}
        eyebrow={detail.slug}
        breadcrumbs={[{ label: 'Tenants', href: '/vendor' }, { label: detail.legal_name }]}
        state={<StatusBadge state={detail.state} />}
        summary={detail.state === 'provisioning'
          ? <>Waiting for a second vendor user to approve. Nothing reaches its admins before that. If nobody else can, invite one under <Link className="text-primary hover:underline" href="/vendor/users">Vendor users</Link>.</>
          : 'Operational metadata only. Business data needs a support session the tenant approves.'}
        actions={<Actions tenant={detail} onStep={setStep} />}
      />
      <section className={SECTION_CARD} aria-labelledby="tenant-meta" data-testid="card">
        <SectionTitle id="tenant-meta" icon="corporate_fare" title="Tenant" />
        <MetaGrid
          items={[
            { label: 'Slug', value: <span className="font-data-mono-md text-data-mono-md text-primary">{detail.slug}</span> },
            { label: 'Data region', value: detail.region },
            { label: 'Isolation tier', value: detail.isolation_tier },
            { label: 'Signed DPA document', value: <span className={`${MONO} break-all`}>{detail.dpa_document_id ?? '—'}</span> },
            { label: 'Created', value: formatDateTime(detail.created_at) },
            { label: 'Background jobs', value: jobHealthLabel(detail.job_health) },
          ]}
        />
      </section>
      <DataTable caption={countLabel(detail.markets.length, 'market')} columns={MARKET_COLUMNS} rows={detail.markets} rowKey={(market) => market.id} empty={{ title: 'No markets.' }} />
      {detail.state !== 'provisioning' && <OffboardingPanel tenant={detail} onChanged={tenant.reload} />}
      {detail.state !== 'provisioning' && <BreachContacts tenantId={detail.id} />}
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
