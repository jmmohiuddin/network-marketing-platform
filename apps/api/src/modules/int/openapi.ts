import { z } from 'zod'
import { publicSnapshotSchemas } from '../cpl/index.js'
import { publicServicingSchemas } from '../crm/index.js'
import { publicOrderSchemas } from '../ord/index.js'
import { publicParticipantSchemas } from '../par/index.js'
import { pageQuery } from '../../lib/pagination.js'
import { WEBHOOK_TOPICS } from './topics.js'

type JsonSchema = Record<string, unknown>

/** JSON Schema 2020-12 (the OpenAPI 3.1 dialect) of a zod schema, without the $schema marker. */
function schemaOf(schema: z.ZodType, io: 'input' | 'output' = 'output'): JsonSchema {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io }) as JsonSchema
  return rest
}

const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` })
const json = (schema: JsonSchema) => ({ 'application/json': { schema } })

const errorSchema = z.object({
  error: z.object({
    code: z.string().describe('Stable machine-readable code, e.g. SCOPE_MISSING'),
    message: z.string(),
    details: z.unknown().describe('Code-specific details or null'),
    request_id: z.string(),
  }),
})

const errorResponse = (description: string) => ({ description, content: json(ref('Error')) })

const KEY_ERRORS = {
  401: errorResponse('API_KEY_INVALID: unknown, revoked or expired key, disabled service account (WWW-Authenticate: Bearer)'),
  403: errorResponse('SCOPE_MISSING (the key lacks the scope) or IP_NOT_ALLOWED (outside the key\'s allow-list)'),
  429: {
    ...errorResponse('RATE_LIMITED: the key\'s per-minute limit is used up'),
    headers: { 'Retry-After': { description: 'Seconds until the limit resets', schema: { type: 'integer' } } },
  },
}

function queryParameters(schema: z.ZodObject): JsonSchema[] {
  const properties = schemaOf(schema, 'input').properties as Record<string, JsonSchema>
  return Object.entries(properties).map(([name, property]) => ({ name, in: 'query', required: false, schema: property }))
}

const SIGNATURE_HEADERS = [
  { name: 'webhook-id', description: 'Event id; the same for every retry of the event (deduplicate on it)' },
  { name: 'webhook-timestamp', description: 'Unix seconds when this attempt was signed' },
  {
    name: 'webhook-signature',
    description: 'Space-separated v1,<base64 HMAC-SHA256> signatures of "<webhook-id>.<webhook-timestamp>.<body>", keyed with '
      + 'the base64 part of the whsec_ secret (Standard Webhooks). Two signatures while a rotated secret is in its grace period.',
  },
].map(({ name, description }) => ({ name, in: 'header', required: true, description, schema: { type: 'string' } }))

function webhook(topic: string, description: string, payload: z.ZodType) {
  const body = z.object({
    id: z.guid().describe('Event id (= webhook-id)'),
    type: z.literal(topic),
    occurred_at: z.iso.datetime(),
    tenant: z.guid().describe('Tenant the event belongs to'),
    data: payload,
  })
  return {
    post: {
      summary: topic,
      description,
      parameters: SIGNATURE_HEADERS,
      requestBody: { required: true, content: json(schemaOf(body)) },
      responses: { '2XX': { description: 'Received. Any other answer, a redirect or a timeout is retried with backoff for 72 hours.' } },
    },
  }
}

const IDEMPOTENCY_KEY = {
  name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 1, maxLength: 255 },
  description: 'A fresh UUID for every request (keys are scoped per tenant and route, so two sources must never share one). '
    + 'Repeating a request with its key returns the stored answer (Idempotent-Replayed: true).',
}

const INGEST_ERRORS = {
  409: errorResponse('ORDER_CONFLICT / EVENT_CONFLICT: the natural key (source_system + source id) was received with a different body; '
    + 'the refusal is stored and listed in the exception queue. Send corrections as order events.'),
  422: errorResponse('A business refusal (code in error.code, e.g. MARKET_NOT_LIVE, TOTALS_MISMATCH, RETURN_EXCEEDS_PURCHASED); stored as '
    + 'a rejected inbound event. IDEMPOTENCY_KEY_REUSED when the key was used for another request.'),
}

function ingestOperation(operationId: string, summary: string, body: string, created: string, replayed: string, held: string) {
  return {
    operationId,
    summary,
    security: [{ bearer: [] }],
    'x-required-scope': 'orders:write',
    parameters: [IDEMPOTENCY_KEY],
    requestBody: { required: true, content: json(ref(body)) },
    responses: {
      201: { description: 'Accepted and recorded', content: json(ref(created)) },
      200: { description: 'The same natural key and body were already recorded: the recorded resource', content: json(ref(replayed)) },
      202: { description: held, content: json(ref('Held')) },
      400: errorResponse('VALIDATION_FAILED (body shape) or IDEMPOTENCY_KEY_REQUIRED'),
      ...INGEST_ERRORS,
      ...KEY_ERRORS,
    },
  }
}

function ingestPaths() {
  return {
    '/v1/orders': {
      post: ingestOperation('ingestOrder', 'Send one order (amounts and volumes are decimal strings of minor units)', 'OrderBody',
        'OrderCreated', 'OrderReplayed', 'Held UNKNOWN_SKU: a SKU has no volumes at the crediting time (exception queue)'),
    },
    '/v1/order-events': {
      post: ingestOperation('ingestOrderEvent', 'Send one refund, return, exchange, chargeback, chargeback reversal or cancellation',
        'OrderEventBody', 'OrderEventCreated', 'OrderEventReplayed', 'Held ORDER_NOT_FOUND: processed automatically when the order arrives'),
    },
  }
}

const ID_PARAMETER = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }

/** A participants:write operation (PLAN B2 2.2, 2.3): Idempotency-Key, the body and response named in components. */
function participantOperation(operationId: string, summary: string, body: string, status: 200 | 201, response: string, byId: boolean) {
  return {
    operationId,
    summary,
    security: [{ bearer: [] }],
    'x-required-scope': 'participants:write',
    parameters: byId ? [ID_PARAMETER, IDEMPOTENCY_KEY] : [IDEMPOTENCY_KEY],
    requestBody: { required: true, content: json(ref(body)) },
    responses: {
      [status]: { description: 'Recorded', content: json(ref(response)) },
      400: errorResponse('VALIDATION_FAILED (body shape) or IDEMPOTENCY_KEY_REQUIRED'),
      ...(byId ? { 404: errorResponse('NOT_FOUND: no such participant or customer') } : {}),
      409: errorResponse('A state conflict (code in error.code, e.g. PARTICIPANT_EXISTS, POSITION_REF_TAKEN, ALREADY_ACCEPTED)'),
      422: errorResponse('A business refusal (code in error.code, e.g. MARKET_NOT_LIVE, TYPE_NOT_ACTIVE, SPONSOR_NOT_FOUND). '
        + 'IDEMPOTENCY_KEY_REUSED when the key was used for another request.'),
      ...KEY_ERRORS,
    },
  }
}

function participantPaths() {
  return {
    '/v1/participants': {
      post: participantOperation('enrolParticipant', 'Enrol a participant, optionally with a position, sponsor, placement and agreement',
        'EnrolmentBody', 201, 'EnrolmentCreated', false),
    },
    '/v1/participants/{id}/type': {
      post: participantOperation('changeParticipantType', 'Schedule a participant type change', 'TypeChangeBody', 200, 'ParticipantTypes', true),
    },
    '/v1/participants/{id}/positions': {
      post: participantOperation('addPosition', 'Add a position to a participant', 'PositionBody', 201, 'PositionCreated', true),
    },
    '/v1/participants/{id}/agreement-acceptances': {
      post: participantOperation('recordAgreementAcceptance', 'Record an agreement acceptance', 'AcceptanceBody', 201, 'AcceptanceCreated', true),
    },
    '/v1/participants/{id}/signals': {
      post: participantOperation('addDuplicateSignals', 'Add duplicate-detection signals (stored hashed)', 'SignalsBody', 200, 'SignalsAdded', true),
    },
    '/v1/customers/{id}/servicing': {
      put: participantOperation('setServicer', 'Set who services a customer from a date (position_ref null = the company)', 'ServicingBody', 200,
        'Servicing', true),
    },
  }
}

const journalExportBody = z.strictObject({ period_id: z.guid().describe('A committed (or paid, closed) period') })
const journalExport = z.object({
  id: z.guid(),
  market: z.object({ id: z.guid(), code: z.string() }),
  period: z.object({ id: z.guid(), starts_at: z.iso.datetime(), ends_at: z.iso.datetime() }),
  line_count: z.int(),
  debit_total_minor: z.string().describe('Minor units, decimal string'),
  credit_total_minor: z.string().describe('Minor units, decimal string'),
  content_sha256: z.string().describe('Hex SHA-256 of the stored gzip'),
  created_by: z.object({ id: z.guid(), type: z.enum(['user', 'service_account', 'system']) }),
  created_at: z.iso.datetime(),
})

/** PLAN B4 2.1: GL journal export by a ledger:export key (all markets; a session needs ledger.export). */
function ledgerPaths() {
  const scope = { security: [{ bearer: [] }], 'x-required-scope': 'ledger:export' }
  return {
    '/v1/ledger/journal-exports': {
      post: {
        operationId: 'createJournalExport', summary: 'Export the GL journal of one period (aggregated by GL code, account type and origin)', ...scope,
        parameters: [IDEMPOTENCY_KEY],
        requestBody: { required: true, content: json(ref('JournalExportBody')) },
        responses: {
          201: { description: 'Exported', content: json({ type: 'object', required: ['data'], properties: { data: ref('JournalExport') } }) },
          400: errorResponse('VALIDATION_FAILED (body shape) or IDEMPOTENCY_KEY_REQUIRED'),
          404: errorResponse('NOT_FOUND: no such period'),
          409: errorResponse('PERIOD_NOT_COMMITTED: only a committed, paid or closed period is exported'),
          422: errorResponse('NOTHING_TO_EXPORT, GL_MAPPING_MISSING (details.account_types), EXPORT_ROW_CAP_EXCEEDED or IDEMPOTENCY_KEY_REUSED'),
          ...KEY_ERRORS,
        },
      },
    },
    '/v1/ledger/journal-exports/{id}/file': {
      get: {
        operationId: 'downloadJournalExport', summary: 'The export as CSV (UTF-8; amounts as decimals in the market currency)', ...scope,
        parameters: [ID_PARAMETER],
        responses: {
          200: { description: 'The CSV file', content: { 'text/csv': { schema: { type: 'string' } } } },
          404: errorResponse('NOT_FOUND: no such export'),
          ...KEY_ERRORS,
        },
      },
    },
  }
}

const dataOf = (schema: JsonSchema) => json({ type: 'object', required: ['data'], properties: { data: schema } })
const EXPORT_ROW = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' }, trigger: { enum: ['manual', 'schedule'] },
    state: { enum: ['queued', 'running', 'completed', 'failed', 'expired'] }, model_version: { type: 'integer' },
    snapshot_at: { type: ['string', 'null'], format: 'date-time' }, table_count: { type: ['integer', 'null'] }, total_rows: { type: ['integer', 'null'] },
    created_at: { type: 'string', format: 'date-time' }, finished_at: { type: ['string', 'null'], format: 'date-time' },
    requested_by: { type: ['object', 'null'], properties: { id: { type: 'string', format: 'uuid' }, type: { type: 'string' } } },
    error: { type: ['object', 'null'], properties: { code: { type: 'string' } } },
  },
}

/** PLAN B6 2.3 (API-32): full data exports by an exports:full key (a session needs export.full for all markets and step-up to create). */
function exportPaths() {
  const scope = { security: [{ bearer: [] }], 'x-required-scope': 'exports:full' }
  const ok = (description: string, schema: JsonSchema) => ({ 200: { description, content: dataOf(schema) }, ...KEY_ERRORS })
  return {
    '/v1/exports/model': { get: { operationId: 'getExportModel', summary: 'The published model: exported tables and columns, exclusions with reasons', ...scope,
      responses: ok('Model', { type: 'object', properties: { version: { type: 'integer' }, tables: { type: 'array' }, excluded_tables: { type: 'array' },
        excluded_columns: { type: 'array' } } }) } },
    '/v1/exports/signing-key': { get: { operationId: 'getExportSigningKey', summary: 'Ed25519 public key (base64 SPKI DER) that signs every manifest', ...scope,
      responses: ok('Key', { type: 'object', properties: { algorithm: { const: 'Ed25519' }, public_key: { type: 'string' }, key_id: { type: 'string' } } }) } },
    '/v1/exports': {
      get: { operationId: 'listExports', summary: 'Full exports, newest first', ...scope, parameters: queryParameters(z.object(pageQuery)),
        responses: ok('Exports', { type: 'array', items: EXPORT_ROW }) },
      post: { operationId: 'createExport', summary: 'Queue a full export of the tenant (one at a time)', ...scope, parameters: [IDEMPOTENCY_KEY],
        requestBody: { required: true, content: json({ type: 'object', additionalProperties: false }) },
        responses: { 202: { description: 'Queued', content: dataOf({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { const: 'queued' } } }) },
          409: errorResponse('EXPORT_RUNNING: another export is queued or running'), ...KEY_ERRORS } },
    },
    '/v1/exports/{id}': { get: { operationId: 'getExport', summary: 'One export with its manifest and the manifest signature (base64)', ...scope,
      parameters: [ID_PARAMETER], responses: { ...ok('Export', EXPORT_ROW), 404: errorResponse('NOT_FOUND: no such export') } } },
    '/v1/exports/{id}/files/{table}': { get: { operationId: 'downloadExportFile', summary: 'One table as gzipped JSON Lines (<table>.jsonl.gz)', ...scope,
      parameters: [ID_PARAMETER, { name: 'table', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'The file', content: { 'application/gzip': { schema: { type: 'string', contentMediaType: 'application/gzip' } } } },
        404: errorResponse('NOT_FOUND: no such export or table, or the export expired'), 500: errorResponse('EXPORT_CORRUPT: the stored file fails its checksum'),
        ...KEY_ERRORS } } },
  }
}

/**
 * GET /v1/openapi.json (AC-INT1-1): the integration surface — key-accessible paths with the zod schemas that
 * validate them, the bearer scheme, the error envelope, and one webhook per subscribable topic.
 */
export function openApiDocument(): Record<string, unknown> {
  const { listQuery, listItem, detail, listMeta, detailMeta } = publicSnapshotSchemas
  const keyOperation = (operationId: string, summary: string, response: JsonSchema, parameters: JsonSchema[]) => ({
    operationId,
    summary,
    security: [{ bearer: [] }],
    'x-required-scope': 'compliance:read',
    parameters,
    responses: { 200: { description: 'OK', content: json(response) }, ...KEY_ERRORS },
  })
  return {
    openapi: '3.1.0',
    info: {
      title: 'Platform integration API',
      version: '1',
      description: 'Integration surface for API keys: compliance reads, order ingestion, participant writes, GL journal exports and full data exports. Cursor pagination: '
        + 'pass meta.next_cursor as cursor; limit 1..200.',
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    paths: {
      '/v1/compliance/snapshots': {
        get: keyOperation(
          'listComplianceSnapshots', 'Compliance report snapshots of every market, newest first',
          { type: 'object', required: ['data', 'meta'], properties: { data: { type: 'array', items: ref('SnapshotListItem') }, meta: schemaOf(listMeta) } },
          queryParameters(listQuery),
        ),
      },
      '/v1/compliance/snapshots/{id}': {
        get: keyOperation(
          'getComplianceSnapshot', 'One snapshot with its figures and input data quality',
          { type: 'object', required: ['data', 'meta'], properties: { data: ref('SnapshotDetail'), meta: schemaOf(detailMeta) } },
          [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        ),
      },
      ...ingestPaths(),
      ...participantPaths(),
      ...ledgerPaths(),
      ...exportPaths(),
    },
    webhooks: Object.fromEntries(WEBHOOK_TOPICS.map(({ topic, description, payload }) => [topic, webhook(topic, description, payload)])),
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'API key: Authorization: Bearer nmpk_…' },
      },
      schemas: {
        Error: schemaOf(errorSchema), SnapshotListItem: schemaOf(listItem), SnapshotDetail: schemaOf(detail),
        OrderBody: schemaOf(publicOrderSchemas.orderBody, 'input'), OrderEventBody: schemaOf(publicOrderSchemas.eventBody, 'input'),
        OrderCreated: schemaOf(publicOrderSchemas.orderCreated), OrderReplayed: schemaOf(publicOrderSchemas.orderReplayed),
        OrderEventCreated: schemaOf(publicOrderSchemas.eventCreated), OrderEventReplayed: schemaOf(publicOrderSchemas.eventReplayed),
        Held: schemaOf(publicOrderSchemas.held),
        EnrolmentBody: schemaOf(publicParticipantSchemas.enrolmentBody, 'input'),
        EnrolmentCreated: schemaOf(publicParticipantSchemas.enrolmentResponse),
        TypeChangeBody: schemaOf(publicParticipantSchemas.typeChangeBody, 'input'),
        ParticipantTypes: schemaOf(publicParticipantSchemas.typesResponse),
        PositionBody: schemaOf(publicParticipantSchemas.positionBody, 'input'),
        PositionCreated: schemaOf(publicParticipantSchemas.positionResponse),
        AcceptanceBody: schemaOf(publicParticipantSchemas.acceptanceBody, 'input'),
        AcceptanceCreated: schemaOf(publicParticipantSchemas.acceptanceResponse),
        SignalsBody: schemaOf(publicParticipantSchemas.signalsBody, 'input'),
        SignalsAdded: schemaOf(publicParticipantSchemas.signalsResponse),
        ServicingBody: schemaOf(publicServicingSchemas.servicingBody, 'input'),
        Servicing: schemaOf(publicServicingSchemas.servicingResponse),
        JournalExportBody: schemaOf(journalExportBody, 'input'), JournalExport: schemaOf(journalExport),
      },
    },
  }
}
