import { createHash } from 'node:crypto'
import { withSystem, type Tx } from '@nmp/db'
import { parse as parseCsv } from 'csv-parse/sync'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope } from '../../lib/http.js'
import type { StoredResponse } from '../../lib/idempotency.js'
import { open } from '../../lib/secret-box.js'
import { finishInstruction, INSTRUCTION_SELECT, type InstructionRow, type TerminalState } from './instructions.js'
import { lockLedger } from './ledger.js'
import { MINOR } from './money.js'
import { webhookSecretContext } from './providers.js'

// D-B4-15: settlement, return and failure arrive as signed sandbox webhooks or a result file. Each event is
// deduplicated through inbound_event (source provider:<config id>) and either moves its instruction or opens an exception.

export interface ProviderEvent {
  readonly state: TerminalState
  readonly reference: string
  readonly amountMinor: string
  readonly currency: string | null
  readonly reason: string | null
}

type Outcome = TerminalState | 'exception'

/**
 * Opens an exception unless an open one already records the same event (kind, reference, amount, state): a signed body
 * replayed under new event ids changes nothing (callers hold the market's ledger lock, so the check is not raced).
 */
async function recordException(tx: Tx, providerId: string, kind: string, event: ProviderEvent, inboundId: string, instructionId: string | null, detail: object) {
  const { rowCount } = await tx.query(
    `SELECT 1 FROM payout_exception WHERE provider_config_id = $1 AND kind = $2 AND reference = $3 AND amount_minor = $4
       AND detail ->> 'state' = $5 AND state = 'open'`,
    [providerId, kind, event.reference, event.amountMinor, event.state],
  )
  if (rowCount !== 0) return
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO payout_exception (tenant_id, provider_config_id, kind, instruction_id, reference, amount_minor, inbound_event_id, detail)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
    [providerId, kind, instructionId, event.reference, event.amountMinor, inboundId, JSON.stringify({ state: event.state, ...detail })],
  )
  await recordAudit(tx, {
    action: 'PAYOUT.EXCEPTION_RECORDED', objectType: 'payout_exception', objectId: rows[0]!.id,
    after: { kind, provider_config_id: providerId, instruction_id: instructionId },
  })
}

/**
 * One provider event for the instruction with this reference among the provider's batches. Lock order as approve,
 * retry and bank file: the market's ledger lock (the provider's market is its batches' market), then the instruction.
 */
async function applyEvent(tx: Tx, providerId: string, event: ProviderEvent, inboundId: string): Promise<Outcome> {
  const { rows: providers } = await tx.query<{ market_id: string }>('SELECT market_id FROM provider_config WHERE id = $1', [providerId])
  await lockLedger(tx, providers[0]!.market_id)
  const { rows } = await tx.query<InstructionRow>(
    `${INSTRUCTION_SELECT} WHERE b.provider_config_id = $1 AND i.provider_ref = $2 FOR UPDATE OF i`, [providerId, event.reference])
  const i = rows[0]
  // shortcut: an event that arrives while an ambiguous submit left provider_ref NULL is an unknown_reference exception and
  // is not re-applied once the status query learns the reference (the instruction stays accepted, money in transit until
  // resolved by hand); match such exceptions on accept() when a real asynchronous provider adapter is added.
  if (i === undefined) {
    await recordException(tx, providerId, 'unknown_reference', event, inboundId, null, {})
    return 'exception'
  }
  if (i.amount_minor !== event.amountMinor || (event.currency !== null && event.currency !== i.currency)) {
    await recordException(tx, providerId, 'amount_mismatch', event, inboundId, i.id, { expected_minor: i.amount_minor, currency: event.currency })
    return 'exception'
  }
  if (['settled', 'returned', 'failed', 'cancelled'].includes(i.state)) {
    await recordException(tx, providerId, 'duplicate_settlement', event, inboundId, i.id, { instruction_state: i.state })
    return 'exception'
  }
  await finishInstruction(tx, i, event.state, event.reason)
  return event.state
}

const hash = (data: Buffer | string) => createHash('sha256').update(data).digest()

/** Records the inbound event once per key; null when the key was already processed (a repeat changes nothing). */
async function firstDelivery(tx: Tx, providerId: string, key: string, payloadHash: Buffer): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state)
     VALUES (app_tenant_id(), 'provider:' || $1::uuid::text, $2, $3, now(), 'processed')
     ON CONFLICT (tenant_id, source, idempotency_key) WHERE state IN ('held', 'processed') DO NOTHING RETURNING id`,
    [providerId, key, payloadHash],
  )
  return rows[0]?.id ?? null
}

export interface WebhookProvider {
  readonly tenantId: string
  readonly secret: string
}

/** The recorded sandbox payout provider a webhook names, with its unsealed secret (system realm); null = 404. */
export async function providerForWebhook(key: Buffer, id: string): Promise<WebhookProvider | null> {
  const { rows } = await withSystem((tx) =>
    tx.query<{ tenant_id: string; adapter: string | null; webhook_secret_sealed: string | null }>(
      'SELECT tenant_id, adapter, webhook_secret_sealed FROM pay_provider_for_webhook($1)', [id]))
  const row = rows[0]
  if (row === undefined || row.adapter !== 'sandbox' || row.webhook_secret_sealed === null) return null
  return { tenantId: row.tenant_id, secret: open(key, row.webhook_secret_sealed, webhookSecretContext(id)) }
}

const STATE_OF = { 'payout.settled': 'settled', 'payout.returned': 'returned', 'payout.failed': 'failed' } as const
const webhookBody = z.strictObject({
  type: z.enum(['payout.settled', 'payout.returned', 'payout.failed']),
  provider_ref: z.string().min(1).max(200),
  amount_minor: z.string().regex(MINOR),
  currency: z.string().regex(/^[A-Z]{3}$/),
  reason: z.string().min(1).max(500).optional(),
})

export interface WebhookDelivery {
  readonly providerId: string
  readonly eventId: string
  readonly raw: Buffer
}

/** POST /v1/webhooks/providers/:id after its signature passed, in the provider's tenant as the system (API-26). */
export async function receiveProviderWebhook(tx: Tx, request: FastifyRequest, delivery: WebhookDelivery): Promise<StoredResponse> {
  let body: unknown = null
  try {
    body = JSON.parse(delivery.raw.toString('utf8'))
  } catch {
    // stays null: refused below as PAYLOAD_INVALID
  }
  const parsed = webhookBody.safeParse(body)
  const eventId = /^[\x21-\x7e]{1,200}$/.test(delivery.eventId) ? delivery.eventId : null
  if (!parsed.success || eventId === null) {
    await tx.query(
      `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state, result)
       VALUES (app_tenant_id(), 'provider:' || $1::uuid::text, $2, $3, now(), 'rejected', '{"code": "PAYLOAD_INVALID"}')`,
      [delivery.providerId, eventId ?? `payload:${hash(delivery.raw).toString('hex')}`, hash(delivery.raw)],
    )
    return {
      statusCode: 422,
      body: { error: { code: 'PAYLOAD_INVALID', message: 'The event needs X-Sandbox-Event-Id and a valid body (amount_minor as a decimal string).', details: null, request_id: request.id } },
    }
  }
  const inboundId = await firstDelivery(tx, delivery.providerId, eventId, hash(delivery.raw))
  if (inboundId !== null) {
    const event = parsed.data
    await applyEvent(tx, delivery.providerId, {
      state: STATE_OF[event.type], reference: event.provider_ref, amountMinor: event.amount_minor, currency: event.currency, reason: event.reason ?? null,
    }, inboundId)
  }
  return { statusCode: 200, body: envelope({ received: true }) }
}

const REPORT_HEADER = ['end_to_end_id', 'status', 'amount_minor', 'reason']
const reportRow = z.strictObject({
  end_to_end_id: z.string().min(1).max(200),
  status: z.enum(['settled', 'returned', 'failed']),
  amount_minor: z.string().regex(MINOR, 'must be minor units as a decimal string'),
  reason: z.string().max(500),
})

const reportInvalid = (line: number, message: string) => new ApiError(422, 'REPORT_INVALID', `Line ${line}: ${message}`, { line, message })

function reportRows(csv: string): z.infer<typeof reportRow>[] {
  let records: string[][]
  try {
    records = parseCsv(csv, { bom: true, skip_empty_lines: true, relax_column_count: true }) as string[][]
  } catch (error) {
    throw reportInvalid((error as { lines?: number }).lines ?? 1, 'the file is not valid CSV')
  }
  if (records[0]?.join(',') !== REPORT_HEADER.join(',')) throw reportInvalid(1, `the header must be ${REPORT_HEADER.join(',')}`)
  return records.slice(1).map((record, index) => {
    if (record.length !== REPORT_HEADER.length) throw reportInvalid(index + 2, `a row has ${REPORT_HEADER.length} columns`)
    const parsed = reportRow.safeParse(Object.fromEntries(REPORT_HEADER.map((name, column) => [name, record[column]])))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!
      throw reportInvalid(index + 2, `${issue.path.join('.')} ${issue.message}`)
    }
    return parsed.data
  })
}

export interface ReportSummary {
  rows: number
  settled: number
  returned: number
  failed: number
  exceptions: number
  unchanged: number
}

/**
 * Separation of duties for a result file: whoever prepared or submitted a batch the file reports on, or generated its
 * bank file, does not record its outcomes (a failed or returned row puts the amount back for retry-failed to pay again).
 */
async function refuseOwnBatches(tx: Tx, providerId: string, references: readonly string[]): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT DISTINCT b.id FROM payout_instruction i JOIN payout_batch b ON b.id = i.batch_id
     WHERE b.provider_config_id = $1 AND i.provider_ref = ANY ($2)
       AND (app_user_id() IN (b.prepared_by, b.submitted_by) OR EXISTS (
         SELECT 1 FROM audit.audit_event a WHERE a.object_type = 'payout_batch' AND a.object_id = b.id
           AND a.action = 'PAYOUT.BANK_FILE_GENERATED' AND a.actor_id = app_user_id()))
     ORDER BY b.id`,
    [providerId, references],
  )
  if (rows.length > 0) {
    throw new ApiError(422, 'SOD_SELF_APPROVAL', 'You prepared, submitted or generated the bank file of a batch this file reports on: another payout.reconcile holder imports it.', {
      reason_code: 'SOD-01', batch_ids: rows.map((row) => row.id),
    })
  }
}

/** POST /v1/payout-providers/:id/settlement-reports: a bank-file provider's result file; rows keyed file:<sha256>:<row> (AC-PAY4-1). */
export async function importSettlementReport(tx: Tx, providerId: string, scope: readonly string[] | null, csv: string): Promise<ReportSummary> {
  const { rows: providers } = await tx.query<{ market_id: string; adapter: string | null }>(
    `SELECT market_id, adapter FROM provider_config WHERE id = $1 AND kind = 'payout'`, [providerId])
  const provider = providers[0]
  if (provider === undefined || (scope !== null && !scope.includes(provider.market_id))) {
    throw notFound()
  }
  // D-B4-14: only the bank-file adapter takes a result file; a sandbox provider's outcomes are its signed webhooks.
  if (provider.adapter !== 'bank_file_csv') {
    throw new ApiError(422, 'ADAPTER_MISMATCH', 'Only a bank-file provider takes a result file: sandbox outcomes arrive as signed webhooks.')
  }
  const rows = reportRows(csv)
  await refuseOwnBatches(tx, providerId, rows.map((row) => row.end_to_end_id))
  const fileHash = hash(csv).toString('hex')
  const summary: ReportSummary = { rows: rows.length, settled: 0, returned: 0, failed: 0, exceptions: 0, unchanged: 0 }
  for (const [index, row] of rows.entries()) {
    const inboundId = await firstDelivery(tx, providerId, `file:${fileHash}:${index + 1}`, hash(Object.values(row).join(',')))
    if (inboundId === null) {
      summary.unchanged += 1
      continue
    }
    const outcome = await applyEvent(tx, providerId, {
      state: row.status, reference: row.end_to_end_id, amountMinor: row.amount_minor, currency: null, reason: row.reason === '' ? null : row.reason,
    }, inboundId)
    if (outcome === 'exception') summary.exceptions += 1
    else summary[outcome] += 1
  }
  await recordAudit(tx, { action: 'PAYOUT.SETTLEMENT_REPORT_IMPORTED', objectType: 'provider_config', objectId: providerId, after: { sha256: fileHash, ...summary } })
  return summary
}
