'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button, LinkButton } from '../../../components/button'
import { DataTable, type DataTableColumn } from '../../../components/data-table'
import { FiltersBar } from '../../../components/filters-bar'
import { Select } from '../../../components/form-field'
import { Icon } from '../../../components/icon'
import { PageHeader } from '../../../components/page-header'
import { StatusBadge } from '../../../components/status-badge'
import { isNotAvailable } from '../../../lib/messages'
import { formatDateTime, jobHealthLabel } from '../format'
import { LoadFailure } from '../page-states'
import { tableError, usePagedList } from '../resource'
import type { TenantView } from '../types'
import { MONO, NoticeCard } from '../ui'
import { RequestSessionDialog } from './request-session-dialog'

const STATES = ['provisioning', 'implementation', 'live', 'archived'] as const
const STATE_LABELS: Readonly<Record<string, string>> = { provisioning: 'Provisioning', implementation: 'Implementation', live: 'Live', archived: 'Archived' }
// Only tenants whose staff can decide a support request (support/requests.ts SUPPORTED_TENANT_STATES).
const SUPPORTED_STATES = new Set(['implementation', 'live'])

/** sc_39 queue-health cell: a dot and the counts; failed jobs get the danger badge. */
function JobHealth({ tenant }: { readonly tenant: TenantView }) {
  if (tenant.job_health.failed > 0) return <StatusBadge state="failed" label={jobHealthLabel(tenant.job_health)} />
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-tertiary-container shrink-0" />
      <span className="font-caption text-caption text-tertiary font-medium">{jobHealthLabel(tenant.job_health)}</span>
    </span>
  )
}

function columns(onRequest: (tenant: TenantView) => void): readonly DataTableColumn<TenantView>[] {
  return [
    {
      key: 'tenant',
      header: 'Tenant',
      cell: (tenant) => (
        <Link href={`/vendor/tenants/${tenant.id}`} className="flex flex-col rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <span className="font-section-heading text-body-sm font-semibold text-on-surface">{tenant.legal_name}</span>{' '}
          <span className="font-data-mono-md text-data-mono-md font-semibold text-primary">({tenant.slug})</span>
        </Link>
      ),
    },
    {
      key: 'region',
      header: 'Region',
      cell: (tenant) => <span className="flex items-center gap-1 font-caption text-caption"><Icon name="location_on" size={14} className="text-outline" />{tenant.region}</span>,
    },
    { key: 'tier', header: 'Isolation tier', cell: (tenant) => <span className="font-caption text-caption bg-surface-container text-on-surface-variant px-1.5 py-0.5 rounded font-medium">{tenant.isolation_tier}</span> },
    { key: 'state', header: 'State', cell: (tenant) => <StatusBadge state={tenant.state} label={STATE_LABELS[tenant.state]} /> },
    { key: 'jobs', header: 'Background jobs', cell: (tenant) => <JobHealth tenant={tenant} /> },
    { key: 'created', header: 'Created', cell: (tenant) => <span className={`${MONO} text-secondary whitespace-nowrap`}>{formatDateTime(tenant.created_at)}</span> },
    {
      key: 'actions',
      header: 'Action',
      align: 'end',
      cell: (tenant) => (SUPPORTED_STATES.has(tenant.state)
        ? <Button size="sm" aria-label={`Request a support session for ${tenant.slug}`} onClick={() => onRequest(tenant)}>Request session</Button>
        : null),
    },
  ]
}

function TenantTable({ state, onRequest }: { readonly state: string; readonly onRequest: (tenant: TenantView) => void }) {
  const tenants = usePagedList<TenantView>('/v1/tenants', { state: state === '' ? undefined : state })
  if (isNotAvailable(tenants.error)) return <LoadFailure error={tenants.error} onRetry={tenants.reload} section />
  return (
    <DataTable
      caption={state === '' ? 'All tenants, by slug' : `Tenants in ${STATE_LABELS[state]?.toLowerCase() ?? state}, by slug`}
      columns={columns(onRequest)}
      rows={tenants.rows}
      rowKey={(tenant) => tenant.id}
      loading={tenants.loading}
      error={tableError(tenants)}
      empty={{ title: state === '' ? 'No tenants yet. Provision the first one.' : 'No tenant is in this state.' }}
      pagination={tenants.pagination}
      stickyFirstColumn
    />
  )
}

/** SC-39 Vendor operations console, Tenants (FR-OPS-001): region, tier, state and job health; no business data. */
export function TenantsPage() {
  const [state, setState] = useState('')
  const [requesting, setRequesting] = useState<TenantView | null>(null)
  return (
    <>
      <PageHeader
        title="Tenants"
        display
        summary="Every tenant with its data region, isolation tier, state and background-job health."
        actions={<LinkButton href="/vendor/provisioning/new" variant="primary" icon="add_circle" data-testid="primary-action">Provision tenant</LinkButton>}
      />
      <NoticeCard icon="verified_user" heading="h2" title="No standing access to tenant data">
        This console shows operational metadata only. Tenant business data needs a support session the tenant approves.
      </NoticeCard>
      <FiltersBar label="Filter tenants">
        <Select
          label="State"
          value={state}
          options={[{ value: '', label: 'All states' }, ...STATES.map((value) => ({ value, label: STATE_LABELS[value] ?? value }))]}
          onChange={(event) => setState(event.target.value)}
        />
      </FiltersBar>
      <TenantTable key={state} state={state} onRequest={setRequesting} />
      {requesting !== null && <RequestSessionDialog tenant={requesting} onClose={() => setRequesting(null)} onRequested={() => setRequesting(null)} />}
    </>
  )
}
