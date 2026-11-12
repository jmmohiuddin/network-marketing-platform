// Test helpers for the admin screens (imported by *.test.tsx only).
import type { RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import type { Me } from '../../lib/me'
import { SessionContext } from '../../lib/session'
import type { FetchMock } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'

export function adminMe(overrides: Partial<Me> = {}): Me {
  return {
    user: { id: '00000000-0000-4000-8000-000000000001', email: 'ada@acme.example', display_name: 'Ada Admin' },
    tenant: { id: 't1', slug: 'acme', legal_name: 'Acme Ltd', region: 'eu', state: 'live' },
    realm: 'tenant',
    roles: [],
    permissions: ['user.manage', 'audit.read', 'export', 'settings.manage', 'vendor_access.decide'],
    mfa: { required: true, enrolled: true, verified: true },
    step_up_at: null,
    navigation: [],
    ...overrides,
  }
}

export function vendorMe(): Me {
  return adminMe({
    user: { id: '00000000-0000-4000-8000-0000000000f1', email: 'vera@vendor.example', display_name: 'Vera Vendor' },
    tenant: null,
    realm: 'vendor',
    permissions: [],
  })
}

/** Answers each request by "METHOD /path" (the handler gets the query); a fresh Response per call, so reloads work. */
export function fetchByRoute(routes: Readonly<Record<string, (query: URLSearchParams) => Response>>): FetchMock {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const [path, search] = String(input).split('?')
    const route = routes[`${init?.method ?? 'GET'} ${path}`]
    if (route === undefined) throw new Error(`unexpected request ${init?.method ?? 'GET'} ${String(input)}`)
    return route(new URLSearchParams(search ?? ''))
  })
}

/** Calls of fetchMock to "METHOD /path...": [url, init] pairs. */
export function callsTo(fetchMock: FetchMock, method: string, path: string): [string, RequestInit][] {
  return fetchMock.mock.calls
    .filter(([input, init]) => (init?.method ?? 'GET') === method && String(input).split('?')[0] === path)
    .map(([input, init]) => [String(input), init ?? {}])
}

export function bodyOf(init: RequestInit): unknown {
  return JSON.parse(String(init.body))
}

export function headerOf(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name)
}

/** Renders inside the real providers with a signed-in user (as AppShell provides). */
export function renderAs(me: Me, ui: ReactElement, fetchMock: FetchMock): RenderResult {
  return renderWithProviders(<SessionContext value={me}>{ui}</SessionContext>, fetchMock)
}
