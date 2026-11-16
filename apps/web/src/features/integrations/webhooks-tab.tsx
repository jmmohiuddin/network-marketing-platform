'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Select } from '../../components/form-field'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { newIdempotencyKey } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { tableError, usePagedList, type PagedList } from '../admin/resource'
import { CHIP, MONO, ROW_ACTIONS } from '../admin/ui'
import { deliveryErrorText, outcomeBadge, retryableIds } from './format'
import { WEBHOOK_ENDPOINTS_PATH, type DeliveryOutcome, type IssuedSecret, type WebhookDelivery, type WebhookEndpoint } from './types'
import { OneTimeSecretDialog, SECTION_HEADING, useFocusAfterAction } from './ui'
import { EditEndpointDialog, RotateSecretDialog, type EndpointChange } from './webhook-dialogs'

export const ENDPOINTS_HEADING_ID = 'integrations-endpoints-heading'
const DELIVERIES_HEADING_ID = 'integrations-deliveries-heading'
const LOST_SECRET = 'If you did not store it, rotate the secret again with no grace period.'
const OUTCOMES: readonly DeliveryOutcome[] = ['scheduled', 'delivered', 'failed', 'dead', 'cancelled']

type EndpointAction =
  | { readonly kind: 'edit' | 'rotate'; readonly endpoint: WebhookEndpoint }
  | { readonly kind: 'issued'; readonly issued: IssuedSecret }

/** A refused Send test or Retry now: shown as a danger banner until the next action (errors are never toasts, UI-04). */
interface Failure {
  readonly title: string
  readonly message: string
}

/** The attempts of one endpoint for one outcome filter (keyed by it, so paging restarts when it changes). */
function DeliveriesTable({ endpoint, outcome, onChanged }: { readonly endpoint: WebhookEndpoint; readonly outcome: string; readonly onChanged: () => void }) {
  const api = useApi()
  const toast = useToast()
  const { readOnly } = useSession()
  const deliveries = usePagedList<WebhookDelivery>(`${WEBHOOK_ENDPOINTS_PATH}/${endpoint.id}/deliveries`, { outcome: outcome === '' ? undefined : outcome })
  const [retrying, setRetrying] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const retryable = retryableIds(deliveries.rows)
  const focusAfter = useFocusAfterAction()
  async function retry(delivery: WebhookDelivery) {
    setRetrying(delivery.id)
    setFailure(null)
    try {
      await api.post(`/v1/webhook-deliveries/${delivery.id}/retry`, {}, { idempotencyKey: newIdempotencyKey() })
      toast({ message: 'The delivery is scheduled to run now.' })
      // The table reloads and the button goes with it: focus the deliveries heading, never <body> (BUG-057).
      focusAfter(`#${DELIVERIES_HEADING_ID}`)
      deliveries.reload()
      onChanged()
    } catch (error) {
      setFailure({ title: `Attempt ${delivery.attempt} of ${delivery.event.type} was not retried`, message: errorMessage(error) })
    } finally {
      setRetrying(null)
    }
  }
  const columns: readonly DataTableColumn<WebhookDelivery>[] = [
    {
      key: 'event', header: 'Event', cell: (delivery) => (
        <div className="flex flex-col min-w-0">
          <span className={`${MONO} text-on-surface`}>{delivery.event.type}</span>
          <span className={`${MONO} text-secondary whitespace-nowrap`}>{formatDateTime(delivery.event.occurred_at)}</span>
        </div>
      ),
    },
    { key: 'attempt', header: 'Attempt', align: 'end', cell: (delivery) => delivery.attempt },
    { key: 'outcome', header: 'Outcome', cell: (delivery) => <StatusBadge {...outcomeBadge(delivery.outcome)} /> },
    { key: 'status', header: 'HTTP status', align: 'end', cell: (delivery) => delivery.status ?? '—' },
    { key: 'error', header: 'Error', cell: (delivery) => deliveryErrorText(delivery.error) },
    { key: 'attempted', header: 'Attempted', cell: (delivery) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(delivery.attempted_at)}</span> },
    { key: 'next', header: 'Next attempt', cell: (delivery) => <span className={`${MONO} whitespace-nowrap`}>{delivery.outcome === 'scheduled' ? formatDateTime(delivery.next_attempt_at) : '—'}</span> },
    {
      key: 'actions', header: 'Actions', align: 'end', cell: (delivery) => readOnly || endpoint.state !== 'active' || !retryable.has(delivery.id) ? null : (
        <Button size="sm" icon="replay" loading={retrying === delivery.id} aria-label={`Retry now: ${delivery.event.type} attempt ${delivery.attempt}`} onClick={() => retry(delivery)}>Retry now</Button>
      ),
    },
  ]
  return (
    <>
      {failure !== null && <Banner tone="danger" title={failure.title}>{failure.message}</Banner>}
      <DataTable
        caption={`Delivery attempts to ${endpoint.url}, newest first`}
        columns={columns}
        rows={deliveries.rows}
        rowKey={(delivery) => delivery.id}
        loading={deliveries.loading}
        error={tableError(deliveries)}
        empty={{ title: outcome === '' ? 'Nothing was sent to this endpoint yet. Send a test event to try it.' : 'No attempts with this outcome.' }}
        pagination={deliveries.pagination}
      />
    </>
  )
}

/**
 * Deliveries of one endpoint, newest first, with an outcome filter, Refresh and Retry now. A new version (Refresh, Send
 * test) loads the table again from its first page.
 */
function Deliveries({ endpoint, version, onRefresh, onChanged }: {
  readonly endpoint: WebhookEndpoint
  readonly version: number
  readonly onRefresh: () => void
  readonly onChanged: () => void
}) {
  const [outcome, setOutcome] = useState('')
  return (
    <section aria-labelledby={DELIVERIES_HEADING_ID} className="flex flex-col gap-space-sm" data-testid="deliveries">
      <div className="flex flex-wrap items-end justify-between gap-space-sm">
        <h3 id={DELIVERIES_HEADING_ID} className={`${SECTION_HEADING} break-all`}>Deliveries to {endpoint.url}</h3>
        <div className="flex items-end gap-space-sm">
          <div className="w-48">
            <Select label="Outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} options={[{ value: '', label: 'All outcomes' }, ...OUTCOMES.map((value) => ({ value, label: outcomeBadge(value).label }))]} />
          </div>
          <Button icon="refresh" aria-label={`Refresh deliveries to ${endpoint.url}`} onClick={onRefresh}>Refresh</Button>
        </div>
      </div>
      <DeliveriesTable key={`${outcome}:${version}`} endpoint={endpoint} outcome={outcome} onChanged={onChanged} />
    </section>
  )
}

/** SC-13 "Webhook subscriptions" tab (FR-INT-001, PLAN B1 2.7): endpoints, their actions and delivery attempts. */
export function WebhooksTab({ endpoints, onChanged }: { readonly endpoints: PagedList<WebhookEndpoint>; readonly onChanged: () => void }) {
  const api = useApi()
  const toast = useToast()
  const { readOnly } = useSession()
  const [action, setAction] = useState<EndpointAction | null>(null)
  const [chosen, setChosen] = useState<WebhookEndpoint | null>(null)
  const [version, setVersion] = useState(0)
  const [testing, setTesting] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  // The chosen endpoint stays shown while the list reloads (its rows are empty meanwhile), then takes the fresh row.
  const selected = chosen === null ? null : endpoints.rows.find((endpoint) => endpoint.id === chosen.id) ?? (endpoints.loading ? chosen : null)
  const close = () => setAction(null)
  const start = (next: EndpointAction) => {
    setFailure(null)
    setAction(next)
  }
  // Deliveries load again and the endpoints too (their last delivery and the failing count).
  const refresh = () => {
    setVersion((value) => value + 1)
    onChanged()
  }
  async function sendTest(endpoint: WebhookEndpoint) {
    setTesting(endpoint.id)
    setFailure(null)
    try {
      await api.post(`${WEBHOOK_ENDPOINTS_PATH}/${endpoint.id}/test`, {}, { idempotencyKey: newIdempotencyKey() })
      toast({ message: 'A test event is queued. Its delivery appears under Deliveries within about a minute; choose Refresh to see it.' })
      setChosen(endpoint)
      refresh()
    } catch (error) {
      setFailure({ title: `The test event to ${endpoint.url} was not sent`, message: errorMessage(error) })
    } finally {
      setTesting(null)
    }
  }
  const columns: readonly DataTableColumn<WebhookEndpoint>[] = [
    {
      key: 'url', header: 'Endpoint', cell: (endpoint) => (
        <div className="flex flex-col min-w-0 max-w-[28rem]">
          <span className={`${MONO} text-on-surface break-all`}>{endpoint.url}</span>
          {endpoint.description !== null && <span className="font-caption text-caption text-secondary">{endpoint.description}</span>}
        </div>
      ),
    },
    { key: 'topics', header: 'Events', cell: (endpoint) => <div className="flex flex-wrap gap-1">{endpoint.topics.map((topic) => <span key={topic} className={`${CHIP} normal-case tracking-normal`}>{topic}</span>)}</div> },
    { key: 'state', header: 'State', cell: (endpoint) => <StatusBadge state={endpoint.state === 'active' ? 'active' : 'retired'} label={endpoint.state === 'active' ? 'Active' : 'Disabled'} /> },
    {
      key: 'last', header: 'Last delivery', cell: (endpoint) => endpoint.last_delivery === null ? 'None yet' : (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge {...outcomeBadge(endpoint.last_delivery.outcome)} />
          <span className={`${MONO} text-secondary whitespace-nowrap`}>{formatDateTime(endpoint.last_delivery.attempted_at)}</span>
        </div>
      ),
    },
    { key: 'secret', header: 'Old secret valid until', cell: (endpoint) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(endpoint.secret_rotation_ends_at)}</span> },
    {
      key: 'actions', header: 'Actions', align: 'end', cell: (endpoint) => (
        <div className={ROW_ACTIONS}>
          <Button variant="tertiary" size="sm" aria-pressed={endpoint.id === selected?.id} aria-label={`Deliveries to ${endpoint.url}`} onClick={() => setChosen(endpoint)}>Deliveries</Button>
          {!readOnly && endpoint.state === 'active' && (
            <>
              <Button size="sm" icon="bolt" loading={testing === endpoint.id} aria-label={`Send test to ${endpoint.url}`} onClick={() => sendTest(endpoint)}>Send test</Button>
              <Button size="sm" icon="autorenew" aria-label={`Rotate secret of ${endpoint.url}`} onClick={() => start({ kind: 'rotate', endpoint })}>Rotate secret</Button>
            </>
          )}
          {!readOnly && <Button size="sm" icon="edit" aria-label={`Edit ${endpoint.url}`} onClick={() => start({ kind: 'edit', endpoint })}>Edit</Button>}
        </div>
      ),
    },
  ]
  return (
    <section aria-labelledby={ENDPOINTS_HEADING_ID} className="flex flex-col gap-space-md">
      <h2 id={ENDPOINTS_HEADING_ID} className={SECTION_HEADING}>Webhook endpoints</h2>
      {failure !== null && <Banner tone="danger" title={failure.title}>{failure.message}</Banner>}
      <DataTable
        caption="Webhook endpoints of this tenant"
        columns={columns}
        rows={endpoints.rows}
        rowKey={(endpoint) => endpoint.id}
        loading={endpoints.loading}
        error={tableError(endpoints)}
        empty={{ title: 'No webhook endpoints yet. Add one to be told when a snapshot is ready, a market goes live or a case is decided.' }}
        pagination={endpoints.pagination}
        selectedKey={selected?.id}
      />
      {selected !== null && <Deliveries key={selected.id} endpoint={selected} version={version} onRefresh={refresh} onChanged={onChanged} />}
      {action?.kind === 'rotate' && <RotateSecretDialog endpoint={action.endpoint} onClose={close} onIssued={(issued) => setAction({ kind: 'issued', issued })} />}
      {action?.kind === 'edit' && (
        <EditEndpointDialog
          endpoint={action.endpoint}
          send={async (change: EndpointChange) => {
            await api.patch(`${WEBHOOK_ENDPOINTS_PATH}/${action.endpoint.id}`, change)
          }}
          onClose={close}
          onSaved={() => {
            close()
            toast({ message: 'The endpoint was saved.' })
            refresh()
          }}
        />
      )}
      {action?.kind === 'issued' && (
        <OneTimeSecretDialog title="Signing secret rotated" label="Signing secret" value={action.issued.secret} lostHint={LOST_SECRET} onClose={() => {
          close()
          onChanged()
        }}>
          <p>Verify each request with this secret (Standard Webhooks signature headers).</p>
        </OneTimeSecretDialog>
      )}
    </section>
  )
}
