import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, closePoolsAfterAll } from '../../../test/helpers/index.js'
import { createIntModule, WEBHOOK_TOPICS } from './index.js'

let app: FastifyInstance
async function loadDocument() {
  const response = await app.inject({ method: 'GET', url: '/v1/openapi.json' })
  expect(response.statusCode).toBe(200)
  return response.json()
}

/** The parsed document, walked freely in assertions (as every test reads response.json()). */
let document: Awaited<ReturnType<typeof loadDocument>>

closePoolsAfterAll()

beforeAll(async () => {
  app = await buildTestApp({ modules: [createIntModule()] })
  document = await loadDocument()
})

afterAll(async () => {
  await app.close()
})

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => (key === '$ref' && typeof item === 'string' ? [item] : refs(item)))
}

const resolve = (pointer: string): unknown =>
  pointer.slice(2).split('/').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], document)

describe('T-B1-21 GET /v1/openapi.json (AC-INT1-1)', () => {
  test('is a public OpenAPI 3.1 document of the key-accessible paths with a bearer scheme', () => {
    expect(document.openapi).toBe('3.1.0')
    expect(document.info).toMatchObject({ title: expect.any(String), version: '1' })
    expect(Object.keys(document.paths)).toEqual(['/v1/compliance/snapshots', '/v1/compliance/snapshots/{id}'])
    expect(document.components.securitySchemes.bearer).toEqual(expect.objectContaining({ type: 'http', scheme: 'bearer' }))
    for (const path of Object.values<{ get: { security: unknown; responses: object } }>(document.paths)) {
      expect(path.get.security).toEqual([{ bearer: [] }])
      expect(Object.keys(path.get.responses)).toEqual(['200', '401', '403', '429'])
    }
  })

  test('takes its schemas from the validating zod schemas: query, list item, detail and the error envelope', () => {
    const list = document.paths['/v1/compliance/snapshots'].get
    const item = document.components.schemas.SnapshotListItem

    expect(list.parameters.map((parameter: { name: string; in: string }) => [parameter.name, parameter.in])).toEqual([['cursor', 'query'], ['limit', 'query']])
    expect(list.parameters[1].schema).toMatchObject({ type: 'integer', minimum: 1, maximum: 200, default: 50 })
    expect(list.responses['200'].content['application/json'].schema.properties.data.items).toEqual({ $ref: '#/components/schemas/SnapshotListItem' })
    expect(item.required).toEqual(expect.arrayContaining(['id', 'state', 'market', 'period_from', 'inputs_hash', 'created_at']))
    expect(item.properties.state.enum).toEqual(['computing', 'ready', 'outdated', 'failed'])
    expect(document.components.schemas.SnapshotDetail.properties.results.type).toBe('array')
    expect(document.components.schemas.Error.properties.error.required).toEqual(['code', 'message', 'details', 'request_id'])
    expect(list.responses['429'].headers['Retry-After']).toBeDefined()
    expect(JSON.stringify(document.components.schemas)).not.toContain('"$schema"')
  })

  test('every $ref resolves inside the document', () => {
    const all = refs(document)
    expect(all.length).toBeGreaterThan(0)
    for (const pointer of all) {
      expect(pointer.startsWith('#/')).toBe(true)
      expect(resolve(pointer)).toBeDefined()
    }
  })

  test('has one webhook per subscribable topic with the Standard Webhooks headers and its payload', () => {
    expect(Object.keys(document.webhooks)).toEqual(WEBHOOK_TOPICS.map((entry) => entry.topic))
    for (const { topic, payload } of WEBHOOK_TOPICS) {
      const operation = document.webhooks[topic].post
      expect(operation.parameters.map((parameter: { name: string; in: string; required: boolean }) => [parameter.name, parameter.in, parameter.required]))
        .toEqual([['webhook-id', 'header', true], ['webhook-timestamp', 'header', true], ['webhook-signature', 'header', true]])
      const body = operation.requestBody.content['application/json'].schema
      expect(body.required).toEqual(['id', 'type', 'occurred_at', 'tenant', 'data'])
      expect(body.properties.type.const).toBe(topic)
      expect(Object.keys(body.properties.data.properties)).toEqual(Object.keys(payload.shape))
    }
  })
})
