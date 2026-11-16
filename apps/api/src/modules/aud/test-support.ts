// Test helpers for evidence document uploads (multipart as a browser sends it).
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { call, type Caller } from '../../../test/helpers/index.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])

/** A multipart body with one file in the field "file" (default: a PNG header) and class=evidence. */
export function documentBody(options: { data?: Buffer; fileName?: string; fields?: Record<string, string> } = {}) {
  const boundary = `nmp-doc-${randomUUID()}`
  const fields = options.fields ?? { class: 'evidence' }
  const chunks: Buffer[] = Object.entries(fields).map(([name, value]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  chunks.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${options.fileName ?? 'evidence.png'}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    options.data ?? PNG,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  )
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

/** POST /v1/documents as a browser would send it. */
export function uploadDocument(
  app: FastifyInstance, as: Caller, options: Parameters<typeof documentBody>[0] & { idempotencyKey?: string } = {},
): Promise<LightMyRequestResponse> {
  const { payload, contentType } = documentBody(options)
  return call(app, {
    method: 'POST', url: '/v1/documents', as, body: payload, headers: { 'content-type': contentType },
    idempotencyKey: options.idempotencyKey ?? true,
  })
}
