'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { RadioGroup, Select, TextInput } from '../../components/form-field'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource, type Resource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { FormDialog } from '../admin/form-dialog'
import { LoadFailure } from '../admin/page-states'
import { MONO, NOTE } from '../admin/ui'
import { PROVIDER_NAMES } from './format'
import { ReasonDialog } from './key-dialogs'
import { CONNECTORS_PATH, type CommerceProvider, type Connector } from './types'
import { CARD, CopyStatusText, IconTile, SECTION_HEADING, useCopy, useFocusAfterAction } from './ui'

export const CONNECTORS_HEADING_ID = 'integrations-connectors-heading'
const NAME_MAX = 100
const SECRET_MIN = 16
const SECRET_MAX = 200
const PROVIDERS: readonly CommerceProvider[] = ['shopify', 'woocommerce']

type Errors = Readonly<Record<string, string | null>>

/** The API's rule for a signing secret (16..200 characters), as the field's error. */
export function secretError(secret: string): string | null {
  if (secret === '') return 'Enter the signing secret the store shows for its webhooks.'
  return secret.length < SECRET_MIN || secret.length > SECRET_MAX ? `Use ${SECRET_MIN} to ${SECRET_MAX} characters.` : null
}

function SecretField({ id, value, error, onChange }: { readonly id: string; readonly value: string; readonly error: string | null | undefined; readonly onChange: (value: string) => void }) {
  return (
    <TextInput
      id={id} type="password" autoComplete="new-password" label="Webhook signing secret" maxLength={SECRET_MAX}
      helper="Copied from the store's webhook settings. Stored sealed and never shown again."
      value={value} error={error} onChange={(event) => onChange(event.target.value)}
    />
  )
}

/** POST /v1/connectors (step-up through ApiProvider): an inbound storefront for one market; the secret is write-only. */
function AddConnectorDialog({ markets, onClose, onAdded }: { readonly markets: readonly Market[]; readonly onClose: () => void; readonly onAdded: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [provider, setProvider] = useState<CommerceProvider>('shopify')
  const [marketId, setMarketId] = useState('')
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const ids = { market_id: 'connector-market', name: 'connector-name', webhook_secret: 'connector-secret' }
  function submit(idempotencyKey: string) {
    const found = { market_id: marketId === '' ? 'Choose the market the store sells in.' : null, name: requiredError('a name', name), webhook_secret: secretError(secret) }
    setErrors(found)
    const items = Object.entries(found).flatMap(([field, message]) => (message === null ? [] : [{ fieldId: ids[field as keyof typeof ids], message }]))
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: ids,
      send: async () => {
        await api.post(CONNECTORS_PATH, { provider, market_id: marketId, name: name.trim(), webhook_secret: secret }, { idempotencyKey })
        toast({ message: `${name.trim()} was added. Copy its webhook URL into the store's webhook settings.` })
        onAdded()
      },
    }
  }
  return (
    <FormDialog title="Add connector" submitLabel="Add connector" onClose={onClose} onSubmit={submit}>
      <p>The store sends its orders, refunds and cancellations to this connector's webhook URL. Nothing is fetched from the store. You may be asked for a code from your authenticator app.</p>
      <RadioGroup legend="Store platform" name="connector-provider" value={provider} onChange={(value) => setProvider(value as CommerceProvider)}
        options={PROVIDERS.map((value) => ({ value, label: PROVIDER_NAMES[value] }))} />
      <Select id={ids.market_id} label="Market" placeholder="Choose a market" value={marketId} error={errors.market_id}
        options={markets.map((market) => ({ value: market.id, label: market.code }))} onChange={(event) => setMarketId(event.target.value)} />
      <TextInput id={ids.name} label="Name" maxLength={NAME_MAX} helper="How your team recognises the store." value={name} error={errors.name} onChange={(event) => setName(event.target.value)} />
      <SecretField id={ids.webhook_secret} value={secret} error={errors.webhook_secret} onChange={setSecret} />
    </FormDialog>
  )
}

/** POST /v1/connectors/:id/rotate-secret (step-up): the store's new signing secret replaces the old one at once. */
function RotateSecretDialog({ connector, onClose, onDone }: { readonly connector: Connector; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit() {
    const found = secretError(secret)
    setError(found)
    if (found !== null) return { items: [{ fieldId: 'rotate-secret', message: found }] }
    return {
      items: [],
      fieldIds: { webhook_secret: 'rotate-secret' },
      send: async () => {
        await api.post(`${CONNECTORS_PATH}/${connector.id}/rotate-secret`, { webhook_secret: secret })
        toast({ message: `The signing secret of ${connector.name} was replaced.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={`Rotate secret of ${connector.name}`} submitLabel="Replace secret" onClose={onClose} onSubmit={submit}>
      <p>Change the secret in the store first: events signed with the old secret are refused from now on. You may be asked for a code from your authenticator app.</p>
      <SecretField id="rotate-secret" value={secret} error={error} onChange={setSecret} />
    </FormDialog>
  )
}

export function WebhookUrl({ url }: { readonly url: string }) {
  const [status, copy] = useCopy(url)
  return (
    <div className="flex flex-col gap-space-xs">
      <div className="flex flex-wrap items-center gap-space-sm">
        <code className={`${MONO} px-space-sm py-space-xs rounded bg-surface-container-low text-on-surface select-all break-all`}>{url}</code>
        <Button size="sm" icon="content_copy" onClick={copy}>Copy webhook URL</Button>
      </div>
      <CopyStatusText status={status} noun="webhook URL" />
    </div>
  )
}

type Action = { readonly kind: 'rotate' | 'withdraw'; readonly connector: Connector }

/** sc_13 connector card: platform tile, name and state, facts strip, webhook URL with copy, rotate and withdraw. */
function ConnectorCard({ connector, onAction }: { readonly connector: Connector; readonly onAction?: (action: Action) => void }) {
  const titleId = `connector-${connector.id}`
  const active = connector.state === 'recorded'
  const actions = active ? onAction : undefined
  return (
    <li aria-labelledby={titleId} className={CARD} data-testid="connector">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs">
        <div className="flex items-center gap-space-sm min-w-0">
          <IconTile name="shopping_bag" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-space-xs">
              <h3 id={titleId} className={SECTION_HEADING}>{connector.name}</h3>
              <span className="font-caption text-caption text-secondary">({PROVIDER_NAMES[connector.provider]})</span>
              <StatusBadge state={active ? 'active' : 'retired'} label={active ? 'Receiving' : 'Withdrawn'} />
            </div>
            <p className={`${MONO} text-secondary mt-0.5`}>Added {formatDateTime(connector.created_at)} by {connector.created_by.display_name ?? 'a user without a name'}{connector.withdrawn_at === null ? '' : ` · withdrawn ${formatDateTime(connector.withdrawn_at)}`}</p>
          </div>
        </div>
        {actions !== undefined && (
          <div className="flex items-center gap-1.5 self-start sm:self-center">
            <Button size="sm" icon="autorenew" aria-label={`Rotate secret of ${connector.name}`} onClick={() => actions({ kind: 'rotate', connector })}>Rotate secret</Button>
            <Button variant="destructive" size="sm" aria-label={`Withdraw ${connector.name}`} onClick={() => actions({ kind: 'withdraw', connector })}>Withdraw</Button>
          </div>
        )}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-space-xs bg-surface-container-low p-space-sm rounded">
        <div className="flex flex-col"><dt className="font-caption text-caption text-secondary uppercase">Market</dt><dd className="font-data-mono-md text-data-mono-md font-semibold text-on-surface">{connector.market.code}</dd></div>
        <div className="flex flex-col"><dt className="font-caption text-caption text-secondary uppercase">Last accepted event</dt><dd className="font-data-mono-md text-data-mono-md font-semibold text-on-surface">{connector.last_ok_at === null ? 'None yet' : formatDateTime(connector.last_ok_at)}</dd></div>
        <div className="flex flex-col"><dt className="font-caption text-caption text-secondary uppercase">Platform</dt><dd className="font-data-mono-md text-data-mono-md font-semibold text-on-surface">{PROVIDER_NAMES[connector.provider]}</dd></div>
      </dl>
      {active && <WebhookUrl url={connector.webhook_url} />}
    </li>
  )
}

export interface ConnectorsTabProps {
  readonly connectors: Resource<readonly Connector[]>
  /** The page's "Add connector" primary opens the dialog through this flag. */
  readonly adding: boolean
  readonly onAddClosed: () => void
}

/** SC-13 "Storefront connectors" tab (FR-ORD-002, D-B2-14): inbound Shopify and WooCommerce webhooks per market. */
export function ConnectorsTab({ connectors, adding, onAddClosed }: ConnectorsTabProps) {
  const { readOnly } = useSession()
  const focusAfter = useFocusAfterAction()
  const markets = useResource<readonly Market[]>(adding ? MARKETS_PATH : null)
  const [action, setAction] = useState<Action | null>(null)
  const list = connectors.data ?? []
  const done = (removed: boolean) => {
    setAction(null)
    if (removed) focusAfter(`#${CONNECTORS_HEADING_ID}`)
    connectors.reload()
  }
  return (
    <section aria-labelledby={CONNECTORS_HEADING_ID} className="flex flex-col gap-space-md">
      <h2 id={CONNECTORS_HEADING_ID} className={SECTION_HEADING}>Storefront connectors</h2>
      <p className={NOTE}>Each store signs its webhooks with the secret you record here; unsigned or wrongly signed events are refused.</p>
      {connectors.error !== null && <LoadFailure error={connectors.error} onRetry={connectors.reload} section />}
      {connectors.loading && <LoadingState label="Loading connectors" />}
      {connectors.data !== null && list.length === 0 && <EmptyState title="No storefront is connected. Add a connector for each store that sells in a market." />}
      {list.length > 0 && (
        <ul className="flex flex-col gap-space-md">
          {list.map((connector) => <ConnectorCard key={connector.id} connector={connector} onAction={readOnly ? undefined : setAction} />)}
        </ul>
      )}
      {adding && markets.error !== null && <LoadFailure error={markets.error} onRetry={markets.reload} section />}
      {adding && markets.data !== null && (
        <AddConnectorDialog
          markets={markets.data}
          onClose={onAddClosed}
          onAdded={() => {
            onAddClosed()
            connectors.reload()
          }}
        />
      )}
      {action?.kind === 'rotate' && <RotateSecretDialog connector={action.connector} onClose={() => setAction(null)} onDone={() => done(false)} />}
      {action?.kind === 'withdraw' && (
        <ReasonDialog
          title={`Withdraw ${action.connector.name}`} submitLabel="Withdraw connector" path={`${CONNECTORS_PATH}/${action.connector.id}/withdraw`}
          intro={`Events from ${action.connector.name} are refused from now on; orders already received stay.`}
          doneMessage={`${action.connector.name} was withdrawn.`} onClose={() => setAction(null)} onDone={() => done(true)}
        />
      )}
    </section>
  )
}
