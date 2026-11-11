import { createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type {} from '@fastify/multipart' // request.parts() and isMultipart() types
import { z } from 'zod'
import { ApiError } from '../../lib/errors.js'
import { parse } from '../../lib/http.js'
import type { Period } from './validate-rows.js'
import { IMPORT_FILES, type ImportFile } from './vocabulary.js'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
// Browsers send text/csv; Excel on Windows sends application/vnd.ms-excel. The content is checked anyway.
const ACCEPTED_TYPES: ReadonlySet<string> = new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'])
const FIELD_COUNT = 3
const MAX_FIELD_BYTES = 100

const fieldsSchema = z
  .strictObject({
    market: z.string().trim().min(1).max(20),
    period_from: z.string().regex(MONTH, 'must be YYYY-MM'),
    period_to: z.string().regex(MONTH, 'must be YYYY-MM'),
  })
  .refine((fields) => fields.period_from <= fields.period_to, {
    message: 'must not be before period_from', path: ['period_to'],
  })

export interface UploadedFile {
  readonly data: Buffer
  /** hex */
  readonly sha256: string
}

/** API-01 input after the synchronous checks: presence, size and content type of the files; the form fields. */
export interface Upload {
  /** Market code (resolved against the tenant's markets later). */
  readonly market: string
  readonly period: Period
  readonly files: Readonly<Record<ImportFile, UploadedFile>>
}

const isImportFile = (name: string): name is ImportFile => (IMPORT_FILES as readonly string[]).includes(name)

const malformed = (message: string): ApiError => new ApiError(400, 'MALFORMED_REQUEST', message)

async function readParts(request: FastifyRequest, maxFileBytes: number) {
  const fields = new Map<string, string>()
  const files = new Map<ImportFile, Buffer>()
  const parts = request.parts({
    limits: { fileSize: maxFileBytes, files: IMPORT_FILES.length, fields: FIELD_COUNT, parts: IMPORT_FILES.length + FIELD_COUNT, fieldSize: MAX_FIELD_BYTES },
  })
  for await (const part of parts) {
    if (part.type === 'field') {
      if (fields.has(part.fieldname)) throw malformed(`The field ${part.fieldname} was sent twice.`)
      fields.set(part.fieldname, String(part.value))
      continue
    }
    if (!isImportFile(part.fieldname) || files.has(part.fieldname)) {
      throw malformed(`Expected one file each for ${IMPORT_FILES.join(', ')}.`)
    }
    if (!ACCEPTED_TYPES.has(part.mimetype)) {
      throw new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload the export files as CSV (text/csv).', { file: part.fieldname })
    }
    files.set(part.fieldname, await part.toBuffer())
  }
  return { fields, files }
}

async function readPartsOrRefuse(request: FastifyRequest, maxFileBytes: number) {
  try {
    return await readParts(request, maxFileBytes)
  } catch (error) {
    if ((error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new ApiError(413, 'FILE_TOO_LARGE', `Each file may be at most ${maxFileBytes} bytes.`, { max_bytes: maxFileBytes })
    }
    throw error
  }
}

export const sha256Hex = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

/** Reads the multipart form of POST /v1/imports: market, period_from, period_to and the three CSV files. */
export async function readUpload(request: FastifyRequest, maxFileBytes: number): Promise<Upload> {
  if (!request.isMultipart()) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the export files as multipart/form-data.')
  }
  const { fields, files } = await readPartsOrRefuse(request, maxFileBytes)
  const missing = IMPORT_FILES.filter((file) => !files.has(file))
  if (missing.length > 0) {
    throw new ApiError(400, 'FILE_MISSING', 'Upload participants, orders and payout_lines together.', { files: missing })
  }
  const form = parse(fieldsSchema, Object.fromEntries(fields))
  const uploaded = Object.fromEntries(
    IMPORT_FILES.map((file) => { const data = files.get(file)!; return [file, { data, sha256: sha256Hex(data) }] }),
  ) as Record<ImportFile, UploadedFile>
  return { market: form.market, period: { from: form.period_from, to: form.period_to }, files: uploaded }
}

/** What the Idempotency-Key's request hash covers for an upload: the form fields and each file's digest. */
export function idempotencyMaterial(upload: Upload): Record<string, unknown> {
  return {
    market: upload.market, period_from: upload.period.from, period_to: upload.period.to,
    files: Object.fromEntries(IMPORT_FILES.map((file) => [file, upload.files[file].sha256])),
  }
}
