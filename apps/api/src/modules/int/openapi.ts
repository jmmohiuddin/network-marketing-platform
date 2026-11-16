import { z } from 'zod'
import { publicSnapshotSchemas } from '../cpl/index.js'
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
      description: 'Read-only integration surface for API keys. Cursor pagination: pass meta.next_cursor as cursor; limit 1..200.',
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
    },
    webhooks: Object.fromEntries(WEBHOOK_TOPICS.map(({ topic, description, payload }) => [topic, webhook(topic, description, payload)])),
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'API key: Authorization: Bearer nmpk_…' },
      },
      schemas: { Error: schemaOf(errorSchema), SnapshotListItem: schemaOf(listItem), SnapshotDetail: schemaOf(detail) },
    },
  }
}
