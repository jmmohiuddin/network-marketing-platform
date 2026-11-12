import { describe, expect, it, vi } from 'vitest'
import { apiError, fetchReturning, json, noContent, ok, requestBody, requestHeaders, requestInit, type FetchMock } from '../test/fetch'
import { ApiError, createApiClient, type ApiHandlers } from './api'

function client(fetchMock: FetchMock, overrides: Partial<ApiHandlers> = {}) {
  const handlers = {
    navigate: vi.fn<(path: string) => void>(),
    currentPath: vi.fn(() => '/imports?state=loaded'),
    stepUp: vi.fn(async () => true),
    supportSession: vi.fn((): string | null => null),
    supportSessionClosed: vi.fn(),
    ...overrides,
  }
  return { api: createApiClient(handlers, fetchMock), handlers }
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(() => null, (failure: unknown) => failure)
  if (!(error instanceof ApiError)) throw new Error('expected an ApiError')
  return error
}

describe('api client requests', () => {
  it('parses the { data, meta } envelope and builds the query string', async () => {
    const fetchMock = fetchReturning(json(200, { data: [{ id: 'a' }], meta: { next_cursor: 'c2' } }, { etag: '"3"' }))
    const { api } = client(fetchMock)
    const result = await api.get<{ id: string }[]>('/v1/imports', { query: { state: 'loaded', cursor: undefined, limit: 50 } })
    expect(result.data).toEqual([{ id: 'a' }])
    expect(result.meta).toEqual({ next_cursor: 'c2' })
    expect(result.headers.get('etag')).toBe('"3"')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/imports?state=loaded&limit=50')
    expect(requestInit(fetchMock).credentials).toBe('same-origin')
  })

  it('sends X-Requested-With on unsafe methods only, and JSON bodies', async () => {
    const fetchMock = fetchReturning(ok({}), ok({}, 201), ok({}), noContent())
    const { api } = client(fetchMock)
    await api.get('/v1/me')
    await api.post('/v1/users', { email: 'a@example.com' })
    await api.put('/v1/settings/x', { value: 1 })
    await api.delete('/v1/auth/sessions/current')
    expect(requestHeaders(fetchMock, 0).has('X-Requested-With')).toBe(false)
    for (const call of [1, 2, 3]) expect(requestHeaders(fetchMock, call).get('X-Requested-With')).toBe('fetch')
    expect(requestHeaders(fetchMock, 1).get('Content-Type')).toBe('application/json')
    expect(requestBody(fetchMock, 1)).toEqual({ email: 'a@example.com' })
  })

  it('sends multipart bodies as they are, without a JSON content type', async () => {
    const fetchMock = fetchReturning(ok({ id: 'b' }, 201))
    const { api } = client(fetchMock)
    const form = new FormData()
    form.set('market', 'eu')
    await api.post('/v1/imports', form, { idempotencyKey: 'k-1' })
    expect(requestInit(fetchMock).body).toBe(form)
    expect(requestHeaders(fetchMock).has('Content-Type')).toBe(false)
    expect(requestHeaders(fetchMock).get('Idempotency-Key')).toBe('k-1')
  })

  it('returns data null for 204 No Content', async () => {
    const { api } = client(fetchReturning(noContent()))
    const result = await api.delete('/v1/auth/sessions/current')
    expect(result.data).toBeNull()
    expect(result.status).toBe(204)
  })
})

describe('api client errors', () => {
  it('throws the error envelope as an ApiError', async () => {
    const { api } = client(fetchReturning(apiError(422, 'MFA_CODE_INVALID', 'The code is not valid.', { a: 1 })))
    const error = await caught(api.post('/v1/auth/sessions/current/mfa', { code: '000000' }))
    expect(error).toMatchObject({ status: 422, code: 'MFA_CODE_INVALID', message: 'The code is not valid.', details: { a: 1 }, requestId: 'req-1' })
  })

  it('turns a network failure into NETWORK_ERROR and a non-JSON answer into SERVICE_UNAVAILABLE', async () => {
    const offline = client(vi.fn(async () => { throw new TypeError('Failed to fetch') }) as FetchMock)
    expect((await caught(offline.api.get('/v1/me'))).code).toBe('NETWORK_ERROR')
    const proxy = client(fetchReturning(new Response('Bad gateway', { status: 502, headers: { 'x-request-id': 'r9' } })))
    expect(await caught(proxy.api.get('/v1/me'))).toMatchObject({ status: 502, code: 'SERVICE_UNAVAILABLE', requestId: 'r9' })
  })

  it('sends UNAUTHENTICATED to sign-in with the current page as next, and never settles', async () => {
    const { api, handlers } = client(fetchReturning(apiError(401, 'UNAUTHENTICATED')))
    const settled = vi.fn()
    api.get('/v1/me').then(settled, settled)
    await vi.waitFor(() => expect(handlers.navigate).toHaveBeenCalledWith('/signin?next=%2Fimports%3Fstate%3Dloaded'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).not.toHaveBeenCalled()
  })

  it('uses the vendor sign-in for vendor pages', async () => {
    const { api, handlers } = client(fetchReturning(apiError(401, 'UNAUTHENTICATED')), { currentPath: () => '/vendor/tenants' })
    void api.get('/v1/tenants')
    await vi.waitFor(() => expect(handlers.navigate).toHaveBeenCalledWith('/signin/vendor?next=%2Fvendor%2Ftenants'))
  })

  it('sends pending MFA to enrolment or verification', async () => {
    const enrol = client(fetchReturning(apiError(403, 'MFA_ENROLMENT_REQUIRED')))
    void enrol.api.get('/v1/users')
    await vi.waitFor(() => expect(enrol.handlers.navigate).toHaveBeenCalledWith('/signin/enrol?next=%2Fimports%3Fstate%3Dloaded'))
    const verify = client(fetchReturning(apiError(403, 'MFA_VERIFICATION_REQUIRED')), { currentPath: () => '/' })
    void verify.api.get('/v1/users')
    await vi.waitFor(() => expect(verify.handlers.navigate).toHaveBeenCalledWith('/signin/mfa'))
  })

  it('asks for step-up and retries once with the same Idempotency-Key', async () => {
    const fetchMock = fetchReturning(apiError(403, 'STEP_UP_REQUIRED'), ok({ id: 'g' }, 201))
    const { api, handlers } = client(fetchMock)
    const result = await api.post('/v1/role-grant-requests/r/decision', { approved: true }, { idempotencyKey: 'key-7' })
    expect(result.data).toEqual({ id: 'g' })
    expect(handlers.stepUp).toHaveBeenCalledTimes(1)
    expect(requestHeaders(fetchMock, 1).get('Idempotency-Key')).toBe('key-7')
    expect(requestBody(fetchMock, 1)).toEqual({ approved: true })
  })

  it('does not loop: a second STEP_UP_REQUIRED is thrown', async () => {
    const { api, handlers } = client(fetchReturning(apiError(403, 'STEP_UP_REQUIRED'), apiError(403, 'STEP_UP_REQUIRED')))
    expect((await caught(api.post('/v1/x', {}))).code).toBe('STEP_UP_REQUIRED')
    expect(handlers.stepUp).toHaveBeenCalledTimes(1)
  })

  it('throws STEP_UP_REQUIRED without retrying when the user cancels', async () => {
    const fetchMock = fetchReturning(apiError(403, 'STEP_UP_REQUIRED'))
    const { api } = client(fetchMock, { stepUp: async () => false })
    expect((await caught(api.post('/v1/x', {}))).code).toBe('STEP_UP_REQUIRED')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('support sessions', () => {
  it('sends X-Support-Session on reads only, so writes and sign-out stay in the vendor realm', async () => {
    const fetchMock = fetchReturning(ok([]), noContent())
    const { api } = client(fetchMock, { supportSession: () => 's-1' })
    await api.get('/v1/audit-events')
    await api.delete('/v1/auth/sessions/current')
    expect(requestHeaders(fetchMock, 0).get('X-Support-Session')).toBe('s-1')
    expect(requestHeaders(fetchMock, 1).get('X-Support-Session')).toBeNull()
  })

  it('sends no header without a session', async () => {
    const fetchMock = fetchReturning(ok([]))
    await client(fetchMock).api.get('/v1/audit-events')
    expect(requestHeaders(fetchMock, 0).get('X-Support-Session')).toBeNull()
  })

  it('leaves the tenant app when the API says the session is no longer open', async () => {
    const { api, handlers } = client(fetchReturning(apiError(403, 'SUPPORT_SESSION_INACTIVE')), { supportSession: () => 's-1' })
    void api.get('/v1/audit-events')
    await vi.waitFor(() => expect(handlers.supportSessionClosed).toHaveBeenCalled())
  })
})
