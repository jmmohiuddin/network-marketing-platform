import type { ReactElement } from 'react'
import { vi } from 'vitest'
import type { Me } from '../../lib/me'
import { SessionContext } from '../../lib/session'
import type { FetchMock } from '../../test/fetch'

export const USER_ID = '00000000-0000-4000-8000-000000000001'

/** A signed-in staff user holding exactly these permissions. */
export function withSession(ui: ReactElement, permissions: readonly string[]): ReactElement {
  const me: Me = {
    user: { id: USER_ID, email: 'officer@example.com', display_name: 'Officer' },
    tenant: { id: 't1', slug: 'acme', legal_name: 'Acme', region: 'eu', state: 'live' },
    realm: 'tenant',
    roles: [],
    permissions,
    mfa: { required: true, enrolled: true, verified: true },
    step_up_at: null,
    navigation: [],
  }
  return <SessionContext value={me}>{ui}</SessionContext>
}

type Route = readonly [method: string, path: RegExp, respond: () => Response]

/** A fetch that answers by method and URL (screens load several resources at once); unknown requests fail. */
export function fetchRoutes(...routes: Route[]): FetchMock {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const route = routes.find(([m, path]) => m === method && path.test(url))
    if (route === undefined) throw new Error(`unexpected request ${method} ${url}`)
    return route[2]()
  })
}

/** Calls made to fetch, as "METHOD url". */
export const callsOf = (fetchMock: FetchMock): string[] =>
  fetchMock.mock.calls.map(([input, init]) => `${init?.method ?? 'GET'} ${String(input)}`)
