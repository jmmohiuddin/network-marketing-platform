import { vi, type Mock } from 'vitest'

/** A JSON response as the API sends it. */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

export const ok = (data: unknown, status = 200): Response => json(status, { data, meta: {} })

export const apiError = (status: number, code: string, message = `${code} message`, details: unknown = null): Response =>
  json(status, { error: { code, message, details, request_id: 'req-1' } })

export const noContent = (): Response => new Response(null, { status: 204 })

export type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>

/** A fetch that answers with the given responses in order (and fails the test when it runs out). */
export function fetchReturning(...responses: Response[]): FetchMock {
  const queue = [...responses]
  return vi.fn(async () => {
    const next = queue.shift()
    if (next === undefined) throw new Error('unexpected request')
    return next
  })
}

/** The init of the n-th call. */
export function requestInit(fetchMock: FetchMock, call = 0): RequestInit {
  const init = fetchMock.mock.calls[call]?.[1]
  if (init === undefined) throw new Error(`no request ${call}`)
  return init
}

export function requestHeaders(fetchMock: FetchMock, call = 0): Headers {
  return new Headers(requestInit(fetchMock, call).headers)
}

export function requestBody(fetchMock: FetchMock, call = 0): unknown {
  return JSON.parse(String(requestInit(fetchMock, call).body))
}
