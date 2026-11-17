import { randomUUID } from 'node:crypto'
import { withSystem, type Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { open, seal } from '../../lib/secret-box.js'

// D-B2-14: commerce connectors are provider_config rows of kind 'commerce' (provider shopify | woocommerce) with the
// tenant's webhook signing secret sealed under SECRET_ENCRYPTION_KEY (context connector:<id>). Inbound only: nothing
// here calls a store.

export type CommerceProvider = 'shopify' | 'woocommerce'

export interface ConnectorView {
  id: string
  provider: CommerceProvider
  name: string
  market: { id: string; code: string }
  state: 'recorded' | 'withdrawn'
  last_ok_at: Date | null
  created_at: Date
  created_by: { id: string; display_name: string | null }
  withdrawn_at: Date | null
}

const CONNECTOR_SELECT = `
  SELECT c.id, c.provider, c.name, jsonb_build_object('id', m.id, 'code', m.code) AS market, c.state, c.last_ok_at, c.created_at,
         jsonb_build_object('id', u.id, 'display_name', u.display_name) AS created_by, c.withdrawn_at
  FROM provider_config c JOIN market m ON m.id = c.market_id JOIN user_account u ON u.id = c.created_by
  WHERE c.kind = 'commerce'`

const sealContext = (id: string) => `connector:${id}`

export async function listConnectors(tx: Tx): Promise<ConnectorView[]> {
  const { rows } = await tx.query<ConnectorView>(`${CONNECTOR_SELECT} ORDER BY c.created_at DESC, c.id DESC`)
  return rows
}

async function connectorView(tx: Tx, id: string): Promise<ConnectorView> {
  const { rows } = await tx.query<ConnectorView>(`${CONNECTOR_SELECT} AND c.id = $1`, [id])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

export interface NewConnector {
  readonly provider: CommerceProvider
  readonly market_id: string
  readonly name: string
  readonly webhook_secret: string
}

/** Installs a connector; names are unique among recorded connectors, one recorded connector per provider and market. */
export async function installConnector(tx: Tx, key: Buffer, input: NewConnector): Promise<ConnectorView> {
  const market = await tx.query('SELECT 1 FROM market WHERE id = $1', [input.market_id])
  if (market.rowCount === 0) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'market_id is not valid: no such market.', { issues: [{ path: 'market_id', message: 'no such market' }] })
  }
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('connectors:' || app_tenant_id(), 0))`)
  const taken = await tx.query(`SELECT 1 FROM provider_config WHERE kind = 'commerce' AND state = 'recorded' AND lower(name) = lower($1)`, [input.name])
  if (taken.rowCount !== 0) throw new ApiError(409, 'CONNECTOR_NAME_TAKEN', 'Another connector already has this name.')
  const id = randomUUID()
  try {
    await tx.query(
      `INSERT INTO provider_config (id, tenant_id, market_id, kind, provider, name, webhook_secret_sealed, state, created_by)
       VALUES ($1, app_tenant_id(), $2, 'commerce', $3, $4, $5, 'recorded', app_user_id())`,
      [id, input.market_id, input.provider, input.name, seal(key, input.webhook_secret, sealContext(id))],
    )
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ApiError(409, 'CONNECTOR_EXISTS', 'This market already has a connector for this provider: withdraw it first.')
    }
    throw error
  }
  await recordAudit(tx, {
    action: 'CONNECTOR.INSTALLED', objectType: 'provider_config', objectId: id,
    after: { provider: input.provider, market_id: input.market_id },
  })
  return connectorView(tx, id)
}

async function lockRecorded(tx: Tx, id: string): Promise<void> {
  const { rows } = await tx.query<{ state: string }>(`SELECT state FROM provider_config WHERE id = $1 AND kind = 'commerce' FOR UPDATE`, [id])
  if (rows[0] === undefined) throw notFound()
  if (rows[0].state !== 'recorded') throw new ApiError(409, 'CONNECTOR_WITHDRAWN', 'This connector was withdrawn.')
}

export async function rotateConnectorSecret(tx: Tx, key: Buffer, id: string, secret: string): Promise<ConnectorView> {
  await lockRecorded(tx, id)
  await tx.query('UPDATE provider_config SET webhook_secret_sealed = $2 WHERE id = $1', [id, seal(key, secret, sealContext(id))])
  await recordAudit(tx, { action: 'CONNECTOR.SECRET_ROTATED', objectType: 'provider_config', objectId: id })
  return connectorView(tx, id)
}

export async function withdrawConnector(tx: Tx, id: string, reason: string): Promise<ConnectorView> {
  await lockRecorded(tx, id)
  await tx.query(
    `UPDATE provider_config SET state = 'withdrawn', withdrawn_at = now(), withdrawn_by = app_user_id() WHERE id = $1`, [id],
  )
  await recordAudit(tx, {
    action: 'CONNECTOR.WITHDRAWN', objectType: 'provider_config', objectId: id, before: { state: 'recorded' }, after: { state: 'withdrawn' }, reason,
  })
  return connectorView(tx, id)
}

export interface WebhookConnector {
  readonly tenantId: string
  readonly provider: CommerceProvider
  readonly marketId: string
  readonly secret: string
}

/** The recorded connector a webhook names, with its unsealed secret (system realm: no tenant is known yet); null = 404. */
export async function connectorForWebhook(key: Buffer, id: string): Promise<WebhookConnector | null> {
  const { rows } = await withSystem((tx) =>
    tx.query<{ tenant_id: string; provider: CommerceProvider; market_id: string; webhook_secret_sealed: string }>(
      'SELECT tenant_id, provider, market_id, webhook_secret_sealed FROM connector_for_webhook($1)', [id],
    ))
  const row = rows[0]
  if (row === undefined) return null
  return { tenantId: row.tenant_id, provider: row.provider, marketId: row.market_id, secret: open(key, row.webhook_secret_sealed, sealContext(id)) }
}

/** FR-ORD-002: a successfully processed delivery marks the connector healthy. */
export async function markConnectorOk(tx: Tx, id: string): Promise<void> {
  await tx.query('UPDATE provider_config SET last_ok_at = now() WHERE id = $1', [id])
}
