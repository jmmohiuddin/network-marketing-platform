'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Banner } from '../../../components/banner'
import { LinkButton } from '../../../components/button'
import { SelectField } from '../../../components/form-field'
import { PageHeader } from '../../../components/page-header'
import { StatusChip } from '../../../components/status-chip'
import { Table, type TableColumn } from '../../../components/table'
import { isNotAvailable } from '../../../lib/messages'
import { formatDateTime, jobHealthLabel } from '../format'
import { LoadFailure } from '../page-states'
import { tableError, usePagedList } from '../resource'
import type { TenantView } from '../types'
import { ConsoleNav } from './console-nav'

const STATES = ['provisioning', 'implementation', 'live', 'archived'] as const
const STATE_LABELS: Readonly<Record<string, string>> = { provisioning: 'Provisioning', implementation: 'Implementation', live: 'Live', archived: 'Archived' }

const COLUMNS: readonly TableColumn<TenantView>[] = [
  { key: 'tenant', header: 'Tenant', cell: (tenant) => <Link href={`/vendor/tenants/${tenant.id}`}>{tenant.legal_name} ({tenant.slug})</Link> },
  { key: 'region', header: 'Region', cell: (tenant) => tenant.region },
  { key: 'tier', header: 'Isolation tier', cell: (tenant) => tenant.isolation_tier },
  { key: 'state', header: 'State', cell: (tenant) => <StatusChip state={tenant.state} label={STATE_LABELS[tenant.state]} /> },
  {
    key: 'jobs',
    header: 'Background jobs',
    cell: (tenant) => (tenant.job_health.failed > 0
      ? <StatusChip state="failed" label={jobHealthLabel(tenant.job_health)} />
      : jobHealthLabel(tenant.job_health)),
  },
  { key: 'created', header: 'Created', cell: (tenant) => formatDateTime(tenant.created_at) },
]

function TenantTable({ state }: { readonly state: string }) {
  const tenants = usePagedList<TenantView>('/v1/tenants', { state: state === '' ? undefined : state })
  if (isNotAvailable(tenants.error)) return <LoadFailure error={tenants.error} onRetry={tenants.reload} section />
  return (
    <Table
      caption={state === '' ? 'All tenants, by slug' : `Tenants in ${STATE_LABELS[state]?.toLowerCase() ?? state}, by slug`}
      columns={COLUMNS}
      rows={tenants.rows}
      rowKey={(tenant) => tenant.id}
      loading={tenants.loading}
      error={tableError(tenants)}
      empty={{ title: state === '' ? 'No tenants yet. Provision the first one.' : 'No tenant is in this state.' }}
      pagination={tenants.pagination}
    />
  )
}

/** SC-39 Vendor operations console, Tenants (FR-OPS-001): region, tier, state and job health; no business data. */
export function TenantsPage() {
  const [state, setState] = useState('')
  return (
    <>
      <ConsoleNav />
      <div className="admin-stack">
        <PageHeader
          title="Tenants"
          summary="Every tenant with its data region, isolation tier, state and background-job health."
          actions={<LinkButton href="/vendor/provisioning/new" variant="primary">Provision tenant</LinkButton>}
        />
        <Banner tone="info">This console shows operational metadata only. Tenant business data needs a support session the tenant approves.</Banner>
        <div className="admin-toolbar">
          <SelectField
            label="State"
            value={state}
            options={[{ value: '', label: 'All states' }, ...STATES.map((value) => ({ value, label: STATE_LABELS[value] ?? value }))]}
            onChange={(event) => setState(event.target.value)}
          />
        </div>
        <TenantTable key={state} state={state} />
      </div>
    </>
  )
}
