import { authRedirectPath } from './navigation'
import { SUPPORT_SESSION_HEADER } from './support-session'

/** Success body of every API route: { data, meta }, plus the response headers (ETag, Retry-After). */
export interface ApiResult<T> {
  readonly data: T
  readonly meta: Readonly<Record<string, unknown>>
  readonly status: number
  readonly headers: Headers
}

/** An error response { error: { code, message, details, request_id } }, or a client-side failure. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  readonly requestId: string | null

  constructor(status: number, code: string, message: string, details: unknown = null, requestId: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code)
}

// RFC 9562 UUID version 4: the version nibble and the variant bits.
const UUID_VERSION_BYTE = 6
const UUID_VARIANT_BYTE = 8

/**
 * A fresh Idempotency-Key (a version 4 UUID). Built from crypto.getRandomValues, which every page has:
 * crypto.randomUUID exists only in secure contexts, so it is missing on plain-http LAN addresses.
 */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[UUID_VERSION_BYTE] = (bytes[UUID_VERSION_BYTE]! & 0x0f) | 0x40
  bytes[UUID_VARIANT_BYTE] = (bytes[UUID_VARIANT_BYTE]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  /** Sent as JSON; a FormData body (multipart upload), or a string body with `contentType`, is sent as is. */
  readonly body?: unknown
  /** Content-Type of a string body sent as is (a CSV upload), instead of JSON. */
  readonly contentType?: string
  /** 'blob': a 2xx body is returned in `data` as a Blob (a CSV download), not read as the JSON envelope. */
  readonly responseType?: 'blob'
  readonly query?: Readonly<Record<string, string | number | boolean | null | undefined>>
  /**
   * Creating POSTs: one key per user action (newIdempotencyKey() when the action starts), kept in the
   * form's state and sent again when the user retries that action, so the server runs it at most once.
   */
  readonly idempotencyKey?: string
  /** Extra headers such as If-Match. */
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
}

export interface ApiHandlers {
  /** Leaves the page for sign-in or the MFA pages. */
  navigate(path: string): void
  /** Path and query of the current page, to return to after sign-in. */
  currentPath(): string
  /** Asks the user for a fresh second factor; resolves true once verified, false when cancelled. */
  stepUp(): Promise<boolean>
  /** The vendor support session this page reads in (sent as X-Support-Session on GET only), or null. */
  supportSession(): string | null
  /** The API refused that session as no longer open: leave the tenant app. */
  supportSessionClosed(): void
}

export interface ApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<ApiResult<T>>
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>>
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>>
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>>
  delete<T>(path: string, options?: RequestOptions): Promise<ApiResult<T>>
}

// Any non-empty value passes the API's CSRF check (SEC-35); a cross-site form cannot send the header.
const CSRF_HEADER = 'X-Requested-With'
const CSRF_VALUE = 'fetch'
const SAFE_METHODS = new Set<Method>(['GET'])

function urlOf(path: string, query: RequestOptions['query']): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) params.set(key, String(value))
  }
  const search = params.toString()
  return search === '' ? path : `${path}?${search}`
}

function headersFor(method: Method, options: RequestOptions): Headers {
  const headers = new Headers({ Accept: 'application/json', ...options.headers })
  if (!SAFE_METHODS.has(method)) headers.set(CSRF_HEADER, CSRF_VALUE)
  if (options.idempotencyKey !== undefined) headers.set('Idempotency-Key', options.idempotencyKey)
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', options.contentType ?? 'application/json')
  return headers
}

function bodyOf({ body, contentType }: RequestOptions): BodyInit | undefined {
  if (body === undefined) return undefined
  return body instanceof FormData || contentType !== undefined ? (body as BodyInit) : JSON.stringify(body)
}

// null: empty body (204); undefined: not JSON (a proxy error page, for example).
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function errorOf(response: Response, body: unknown): ApiError {
  const requestId = response.headers.get('x-request-id')
  const error = (body as { error?: Record<string, unknown> } | null | undefined)?.error
  if (error !== undefined && typeof error.code === 'string' && typeof error.message === 'string') {
    const id = typeof error.request_id === 'string' ? error.request_id : requestId
    return new ApiError(response.status, error.code, error.message, error.details ?? null, id)
  }
  return new ApiError(response.status, 'SERVICE_UNAVAILABLE', 'The service did not answer as expected.', null, requestId)
}

function resultOf<T>(response: Response, body: unknown): ApiResult<T> {
  if (body === undefined) throw errorOf(response, body)
  const envelope = (body ?? { data: null, meta: {} }) as { data: T; meta?: Record<string, unknown> }
  return { data: envelope.data, meta: envelope.meta ?? {}, status: response.status, headers: response.headers }
}

async function send<T>(fetchImpl: typeof fetch, method: Method, path: string, options: RequestOptions): Promise<ApiResult<T>> {
  let response: Response
  try {
    response = await fetchImpl(urlOf(path, options.query), {
      method, headers: headersFor(method, options), body: bodyOf(options),
      credentials: 'same-origin', signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'NETWORK_ERROR', 'The request did not reach the service.')
  }
  if (response.ok && options.responseType === 'blob') {
    return { data: (await response.blob()) as T, meta: {}, status: response.status, headers: response.headers }
  }
  const body = await readJson(response)
  if (!response.ok) throw errorOf(response, body)
  return resultOf<T>(response, body)
}

/**
 * The typed API client. Auth errors leave the page (UNAUTHENTICATED to sign-in, MFA_ENROLMENT_REQUIRED to
 * enrolment, MFA_VERIFICATION_REQUIRED to verification) and the returned promise never settles, so the page
 * keeps its loading state while the browser navigates. STEP_UP_REQUIRED asks for a second factor and retries
 * the same request (same Idempotency-Key) once. Inside a vendor support session reads carry X-Support-Session, and
 * SUPPORT_SESSION_INACTIVE leaves the tenant app. Every other error is thrown as an ApiError.
 */
export function createApiClient(handlers: ApiHandlers, fetchImpl: typeof fetch = fetch): ApiClient {
  async function run<T>(method: Method, path: string, options: RequestOptions, stepUpAllowed: boolean): Promise<ApiResult<T>> {
    // Reads only: a support session is read-only, and sign-out or ending the session must run in the vendor realm.
    const session = SAFE_METHODS.has(method) ? handlers.supportSession() : null
    const sent = session === null ? options : { ...options, headers: { ...options.headers, [SUPPORT_SESSION_HEADER]: session } }
    try {
      return await send<T>(fetchImpl, method, path, sent)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (session !== null && error.code === 'SUPPORT_SESSION_INACTIVE') {
        handlers.supportSessionClosed()
        return new Promise<never>(() => undefined)
      }
      const redirect = authRedirectPath(error.code, handlers.currentPath())
      if (redirect !== null) {
        handlers.navigate(redirect)
        return new Promise<never>(() => undefined)
      }
      if (error.code !== 'STEP_UP_REQUIRED' || !stepUpAllowed || !(await handlers.stepUp())) throw error
      return run<T>(method, path, options, false)
    }
  }
  const request = <T>(method: Method, path: string, options: RequestOptions = {}) => run<T>(method, path, options, true)
  return {
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    put: (path, body, options) => request('PUT', path, { ...options, body }),
    patch: (path, body, options) => request('PATCH', path, { ...options, body }),
    delete: (path, options) => request('DELETE', path, options),
  }
}
