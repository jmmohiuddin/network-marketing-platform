'use client'

import { useState } from 'react'
import { Button } from '../../components/button'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { TabPanel, Tabs } from '../../components/tabs'
import { useToast } from '../../components/toast'
import { isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { LoadFailure, useTabParam } from '../admin/page-states'
import { usePagedList, type PagedList } from '../admin/resource'
import { NOTE } from '../admin/ui'
import { ApiKeysTab } from './api-keys-tab'
import { failingEndpointCount, usableKeyCount } from './format'
import { CreateServiceAccountDialog } from './key-dialogs'
import { SERVICE_ACCOUNTS_PATH, WEBHOOK_ENDPOINTS_PATH, type IssuedSecret, type ServiceAccount, type WebhookEndpoint } from './types'
import { OneTimeSecretDialog } from './ui'
import { CreateEndpointDialog } from './webhook-dialogs'
import { WebhooksTab } from './webhooks-tab'

const ID_PREFIX = 'integrations'
const LOST_SECRET = 'If you did not store it, rotate the secret with no grace period.'

type PageDialog = { readonly kind: 'account' | 'endpoint' } | { readonly kind: 'secret'; readonly issued: IssuedSecret }

const paged = (list: PagedList<unknown>) => list.pagination.hasNext || list.pagination.hasPrevious

/** KPI value of a loaded list; null (shown as "—") while loading or after an error. */
function countOf<T>(list: PagedList<T>, count: (rows: readonly T[]) => number): string | null {
  return list.loading || list.error !== null ? null : String(count(list.rows))
}

/** sc_13 telemetry cards, from real counts only (FE-38: per loaded page when the list has more pages). */
function IntegrationKpis({ accounts, endpoints }: { readonly accounts: PagedList<ServiceAccount>; readonly endpoints: PagedList<WebhookEndpoint> }) {
  const scope = (list: PagedList<unknown>, all: string) => (paged(list) ? 'On this page of the list' : all)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md" data-testid="kpis">
      <KpiCard label="Usable API keys" icon="vpn_key" value={countOf(accounts, usableKeyCount)} detail={scope(accounts, 'Active or in a rotation grace period')} />
      <KpiCard label="Service accounts" icon="smart_toy" value={countOf(accounts, (rows) => rows.length)} detail={scope(accounts, 'Systems with API access')} />
      <KpiCard label="Webhook endpoints" icon="webhook" value={countOf(endpoints, (rows) => rows.filter((endpoint) => endpoint.state === 'active').length)} detail={scope(endpoints, 'Active, receiving events')} />
      <KpiCard label="Endpoints failing" icon="sync_problem" value={countOf(endpoints, failingEndpointCount)} detail={scope(endpoints, 'Latest attempt failed or was given up')} />
    </div>
  )
}

/**
 * SC-13 Integrations (FR-IAM-006, FR-INT-001; PLAN B1 5): public API keys of service accounts and webhook
 * subscriptions with their deliveries. integration.manage; minting, rotating and revoking ask for step-up.
 */
export function IntegrationsPage() {
  const { readOnly } = useSession()
  const toast = useToast()
  const accounts = usePagedList<ServiceAccount>(SERVICE_ACCOUNTS_PATH)
  const endpoints = usePagedList<WebhookEndpoint>(WEBHOOK_ENDPOINTS_PATH)
  const [dialog, setDialog] = useState<PageDialog | null>(null)
  const known = (list: PagedList<unknown>) => !list.loading && list.error === null && !paged(list)
  const tabs = [
    { id: 'api-keys', label: 'Public API keys', ...(known(accounts) ? { count: accounts.rows.length } : {}) },
    { id: 'webhooks', label: 'Webhook subscriptions', ...(known(endpoints) ? { count: endpoints.rows.length } : {}) },
  ]
  const [tab, selectTab] = useTabParam(tabs)
  const failure = [accounts.error, endpoints.error].find(isNotAvailable)
  if (failure !== undefined) return <LoadFailure error={failure} onRetry={accounts.reload} />
  const close = () => setDialog(null)
  const primary = tab === 'api-keys'
    ? <Button variant="primary" icon="add_circle" data-testid="primary-action" onClick={() => setDialog({ kind: 'account' })}>Create service account</Button>
    : <Button variant="primary" icon="add_circle" data-testid="primary-action" onClick={() => setDialog({ kind: 'endpoint' })}>Add webhook endpoint</Button>
  return (
    <>
      <PageHeader
        title="Integrations"
        summary="API keys for the systems that read your data, and webhooks that tell your systems when something happens."
        actions={readOnly ? undefined : primary}
      />
      <IntegrationKpis accounts={accounts} endpoints={endpoints} />
      <div>
        <Tabs label="Integrations" idPrefix={ID_PREFIX} tabs={tabs} selected={tab} onSelect={selectTab} />
        <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
          {tab === 'api-keys' && <ApiKeysTab accounts={accounts} onChanged={accounts.reload} />}
          {tab === 'webhooks' && <WebhooksTab endpoints={endpoints} onChanged={endpoints.reload} />}
        </TabPanel>
      </div>
      {dialog?.kind === 'account' && (
        <CreateServiceAccountDialog
          onClose={close}
          onCreated={() => {
            close()
            accounts.reload()
          }}
        />
      )}
      {dialog?.kind === 'endpoint' && (
        <CreateEndpointDialog
          onClose={close}
          onIssued={(issued) => {
            setDialog({ kind: 'secret', issued })
            endpoints.reload()
          }}
        />
      )}
      {dialog?.kind === 'secret' && (
        <OneTimeSecretDialog
          title="Webhook endpoint added" label="Signing secret" value={dialog.issued.secret} lostHint={LOST_SECRET}
          onClose={() => {
            close()
            toast({ message: 'The endpoint is active. Send a test event to try it.' })
          }}
        >
          <p className={`${NOTE} break-all`}>Events go to {dialog.issued.endpoint.url}. Verify each request with this secret (Standard Webhooks signature headers).</p>
        </OneTimeSecretDialog>
      )}
    </>
  )
}
