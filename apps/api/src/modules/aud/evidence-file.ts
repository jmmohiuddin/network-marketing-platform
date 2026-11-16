import { createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type {} from '@fastify/multipart' // request.parts() and isMultipart() types
import { z } from 'zod'
import { ApiError } from '../../lib/errors.js'
import { parse } from '../../lib/http.js'

// The file type is decided by the content, never by the client's Content-Type or file name.
const SIGNATURES: readonly { readonly mime: string; readonly magic: readonly number[] }[] = [
  { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
]

export const EVIDENCE_TYPES: readonly string[] = SIGNATURES.map((signature) => signature.mime)

const MAX_FILE_NAME = 200
const fieldsSchema = z.strictObject({ class: z.literal('evidence') })

export interface EvidenceFile {
  readonly data: Buffer
  readonly mime: string
  /** hex */
  readonly sha256: string
  readonly fileName: string
}

export function detectType(data: Buffer): string | null {
  const match = SIGNATURES.find(({ magic }) => data.length >= magic.length && magic.every((byte, index) => data[index] === byte))
  return match?.mime ?? null
}

/** The last path segment, NFC, without control or format characters (no bidi tricks), at most 200 characters. */
export function sanitiseFileName(raw: string | undefined): string {
  const base = (raw ?? '').split(/[/\\]/).pop() ?? ''
  const clean = base.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
  const short = [...clean].slice(0, MAX_FILE_NAME).join('').trim()
  return short === '' ? 'document' : short
}

/** attachment with an ASCII fallback and the exact name as RFC 8187 filename*. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

const malformed = (message: string): ApiError => new ApiError(400, 'MALFORMED_REQUEST', message)

async function readParts(request: FastifyRequest, maxFileBytes: number) {
  const fields: Record<string, string> = {}
  let file: { data: Buffer; name: string } | null = null
  const parts = request.parts({ limits: { fileSize: maxFileBytes, files: 1, fields: 1, parts: 2, fieldSize: 100 } })
  for await (const part of parts) {
    if (part.type === 'field') {
      fields[part.fieldname] = String(part.value)
      continue
    }
    if (part.fieldname !== 'file') throw malformed('Send the document as the form field "file".')
    file = { data: await part.toBuffer(), name: part.filename }
  }
  return { fields, file }
}

/** POST /v1/documents: one file in the field "file" and class=evidence (PLAN B1 section 2.8). */
export async function readEvidenceFile(request: FastifyRequest, maxFileBytes: number): Promise<EvidenceFile> {
  if (!request.isMultipart()) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the document as multipart/form-data.')
  }
  let read: Awaited<ReturnType<typeof readParts>>
  try {
    read = await readParts(request, maxFileBytes)
  } catch (error) {
    if ((error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new ApiError(413, 'FILE_TOO_LARGE', `A document may be at most ${maxFileBytes} bytes.`, { max_bytes: maxFileBytes })
    }
    throw error
  }
  parse(fieldsSchema, read.fields)
  // A browser form with no file chosen still sends the part, with an empty name and no bytes.
  if (read.file === null || read.file.data.length === 0) throw new ApiError(400, 'FILE_MISSING', 'Choose a file to upload.')
  const mime = detectType(read.file.data)
  if (mime === null) {
    throw new ApiError(415, 'FILE_TYPE_NOT_ALLOWED', 'Upload a PDF, PNG or JPEG file.', { types: EVIDENCE_TYPES })
  }
  return {
    data: read.file.data,
    mime,
    sha256: createHash('sha256').update(read.file.data).digest('hex'),
    fileName: sanitiseFileName(read.file.name),
  }
}
