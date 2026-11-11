import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'

/** An error the client may see: HTTP status, stable machine code, safe message, optional details. */
export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details: unknown

  constructor(statusCode: number, code: string, message: string, details: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export const notFound = (): ApiError => new ApiError(404, 'NOT_FOUND', 'The resource does not exist.')
export const unauthenticated = (): ApiError => new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
export const permissionDenied = (): ApiError =>
  new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission for this action.')

export function validationFailed(error: ZodError): ApiError {
  const issues = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
  return new ApiError(400, 'VALIDATION_FAILED', 'The request is not valid.', { issues })
}

// Codes for errors raised by Fastify itself (malformed JSON, wrong content type, body too large).
const FRAMEWORK_CODES: Readonly<Record<number, string>> = {
  400: 'MALFORMED_REQUEST',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
}

interface ErrorBody {
  error: { code: string; message: string; details: unknown; request_id: string }
}

function body(request: FastifyRequest, code: string, message: string, details: unknown): ErrorBody {
  return { error: { code, message, details, request_id: request.id } }
}

function toApiError(error: FastifyError | Error): ApiError | null {
  if (error instanceof ApiError) return error
  if (error instanceof ZodError) return validationFailed(error)
  const status = (error as FastifyError).statusCode
  if (status !== undefined && status >= 400 && status < 500) {
    return new ApiError(status, FRAMEWORK_CODES[status] ?? 'MALFORMED_REQUEST', error.message)
  }
  return null
}

/** Every error leaves as { error: { code, message, details, request_id } }; unexpected ones as a bare 500. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    const known = toApiError(error)
    if (known !== null) {
      if (known.statusCode >= 500) request.log.error({ err: error }, 'request failed')
      return reply.code(known.statusCode).send(body(request, known.code, known.message, known.details))
    }
    request.log.error({ err: error }, 'unexpected error')
    return reply.code(500).send(body(request, 'INTERNAL_ERROR', 'Something went wrong. Try again later.', null))
  })
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send(body(request, 'NOT_FOUND', 'No such endpoint.', null)),
  )
}
