'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { RadioGroup, TextInput } from '../../components/form-field'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource, type Resource } from '../../lib/use-resource'
import { FormDialog } from '../admin/form-dialog'
import { LoadFailure } from '../admin/page-states'
import { MONO, NOTE } from '../admin/ui'
import { marketScope } from '../markets/format'
import { ReviewChip } from '../markets/gate-inspector'
import type { ProviderRecord } from '../markets/types'
import { WebhookUrl } from './connectors-tab'
import { CARD, IconTile, SECTION_HEADING } from './ui'

export const PAYOUT_PROVIDERS_HEADING_ID = 'integrations-payout-providers-heading'
type Adapter = NonNullable<ProviderRecord['adapter']>
const ADAPTERS: readonly { readonly value: Adapter; readonly label: string; readonly helper: string }[] = [
  { value: 'sandbox', label: 'Sandbox', helper: 'An in-process test provider: it accepts instructions and reports settlements and returns through signed webhooks.' },
  { value: 'bank_file_csv', label: 'Bank file (CSV)', helper: 'A file you upload to the bank yourself; its result file is imported in Payout reconciliation.' },
]
const ADAPTER_NAMES: Readonly<Record<Adapter, string>> = { sandbox: 'Sandbox', bank_file_csv: 'Bank file (CSV)' }
// PLAN B4 2.3: a sandbox webhook secret has 24 to 128 characters.
const SECRET_MIN = 24
const SECRET_MAX = 128

export function adapterSecretError(secret: string): string | null {
  if (secret === '') return 'Enter the webhook secret the sandbox signs its events with.'
  return secret.length < SECRET_MIN || secret.length > SECRET_MAX ? `Use ${SECRET_MIN} to ${SECRET_MAX} characters.` : null
}

// shortcut: built from the page origin, which is the API's webUrl in every deployment so far; read a webhook_url from
// GET /v1/provider-configs instead when the API returns one (as connectors do).
const webhookUrl = (id: string): string => `${window.location.origin}/v1/webhooks/providers/${id}`

/** PUT /v1/provider-configs/:id/adapter (integration.manage, step-up through ApiProvider); the secret is write-only. */
function ConfigureAdapterDialog({ record, onClose, onDone }: { readonly record: ProviderRecord; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [adapter, setAdapter] = useState<Adapter>(record.adapter ?? 'sandbox')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit() {
    const found = adapter === 'sandbox' ? adapterSecretError(secret) : null
    setError(found)
    if (found !== null) return { items: [{ fieldId: 'adapter-secret', message: found }] }
    return {
      items: [],
      fieldIds: { webhook_secret: 'adapter-secret' },
      send: async () => {
        await api.put(`/v1/provider-configs/${record.id}/adapter`, adapter === 'sandbox' ? { adapter, webhook_secret: secret } : { adapter })
        toast({ message: `${record.provider} now pays through the ${ADAPTER_NAMES[adapter].toLowerCase()} adapter.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={`Configure ${record.provider}`} submitLabel="Save adapter" onClose={onClose} onSubmit={submit}>
      <p>Only sandbox adapters exist in this build: no real money moves through either adapter. You may be asked for a code from your authenticator app.</p>
      <RadioGroup legend="Adapter" name="payout-adapter" value={adapter} onChange={(value) => setAdapter(value as Adapter)} options={ADAPTERS} />
      {adapter === 'sandbox' && (
        <TextInput
          id="adapter-secret" type="password" autoComplete="new-password" label="Webhook secret" maxLength={SECRET_MAX}
          helper={`${SECRET_MIN} to ${SECRET_MAX} characters. Stored sealed and never shown again; saving replaces the current secret.`}
          value={secret} error={error} onChange={(event) => setSecret(event.target.value)}
        />
      )}
    </FormDialog>
  )
}

function ProviderCard({ record, market, onConfigure }: { readonly record: ProviderRecord; readonly market: Market | undefined; readonly onConfigure?: () => void }) {
  const titleId = `payout-provider-${record.id}`
  const recorded = record.state === 'recorded'
  return (
    <li aria-labelledby={titleId} className={CARD} data-testid="payout-provider">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs">
        <div className="flex items-center gap-space-sm min-w-0">
          <IconTile name="account_balance" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-space-xs">
              <h3 id={titleId} className={SECTION_HEADING}>{record.provider}</h3>
              <StatusBadge state={recorded ? 'accepted' : 'retired'} label={recorded ? 'Recorded' : 'Withdrawn'} />
              <ReviewChip record={record} />
            </div>
            <p className={`${MONO} text-secondary mt-0.5`}>Recorded {formatDateTime(record.created_at)} by {record.created_by.display_name ?? 'a user without a name'}</p>
          </div>
        </div>
        {recorded && onConfigure !== undefined && (
          <Button size="sm" icon="settings" className="self-start sm:self-center" aria-label={`Configure ${record.provider}`} onClick={onConfigure}>Configure</Button>
        )}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-space-xs bg-surface-container-low p-space-sm rounded">
        <div className="flex flex-col"><dt className="font-caption text-caption text-secondary uppercase">Market</dt><dd className="font-data-mono-md text-data-mono-md font-semibold text-on-surface">{market?.code ?? '—'}</dd></div>
        <div className="flex flex-col"><dt className="font-caption text-caption text-secondary uppercase">Adapter</dt><dd className="font-data-mono-md text-data-mono-md font-semibold text-on-surface">{record.adapter === null ? 'Not configured' : ADAPTER_NAMES[record.adapter]}</dd></div>
        <div className="flex flex-col"><dt className="font-caption text-caption text-secondary uppercase">Funds holder</dt><dd className="font-body-sm text-body-sm font-semibold text-on-surface break-words">{record.funds_holder ?? '—'}</dd></div>
      </dl>
      {recorded && record.adapter === 'sandbox' && (
        <>
          <p className={NOTE}>{record.webhook_configured ? 'The sandbox signs its events with the stored secret. Send them to this URL:' : 'No webhook secret is stored: configure the adapter again.'}</p>
          {record.webhook_configured && <WebhookUrl url={webhookUrl(record.id)} />}
        </>
      )}
    </li>
  )
}

/**
 * SC-13 "Payout providers" tab (FR-PAY-002, D-B4-14, D-B4-20): the payout provider approvals recorded per market (SC-17),
 * their adapter (Sandbox or Bank file CSV; set by integration.manage over all markets, step-up) and review date.
 */
export function PayoutProvidersTab({ providers }: { readonly providers: Resource<readonly ProviderRecord[]> }) {
  const { me, can, readOnly } = useSession()
  const markets = useResource<readonly Market[]>(MARKETS_PATH)
  const [configuring, setConfiguring] = useState<ProviderRecord | null>(null)
  const canConfigure = !readOnly && can('integration.manage') && marketScope(me, 'integration.manage') === 'all'
  const byId = new Map((markets.data ?? []).map((market) => [market.id, market]))
  const list = providers.data ?? []
  return (
    <section aria-labelledby={PAYOUT_PROVIDERS_HEADING_ID} className="flex flex-col gap-space-md">
      <h2 id={PAYOUT_PROVIDERS_HEADING_ID} className={SECTION_HEADING}>Payout providers</h2>
      <p className={NOTE}>Only sandbox adapters exist in this build: batches paid through them move no real money. Approvals are recorded per market in the market launch checklist.</p>
      {providers.error !== null && <LoadFailure error={providers.error} onRetry={providers.reload} section />}
      {providers.loading && <LoadingState label="Loading payout providers" />}
      {providers.data !== null && list.length === 0 && <EmptyState title="No payout provider is recorded. Record one in a market's launch checklist, then configure its adapter here." />}
      {list.length > 0 && (
        <ul className="flex flex-col gap-space-md">
          {list.map((record) => (
            <ProviderCard key={record.id} record={record} market={record.market_id === null ? undefined : byId.get(record.market_id)}
              onConfigure={canConfigure ? () => setConfiguring(record) : undefined} />
          ))}
        </ul>
      )}
      {configuring !== null && (
        <ConfigureAdapterDialog
          record={configuring} onClose={() => setConfiguring(null)}
          onDone={() => {
            setConfiguring(null)
            providers.reload()
          }}
        />
      )}
    </section>
  )
}
