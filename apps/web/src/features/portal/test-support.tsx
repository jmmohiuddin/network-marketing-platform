// Fixtures and helpers for the portal tests (imported by *.test.tsx only).
import type { RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { json, type FetchMock } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { PortalProvider, type Portal } from './shell'
import type { PortalMe, PortalProfile, Statement, StatementSummary } from './types'

/** What the API sends as rule_name: the engine's rule description (renderRule), never shown to a distributor. */
export const ENGINE_RULE = 'Pays 5 % of pv on sponsor levels 1–1; compression none; reversal: order line'

export const RUN = '10000000-0000-4000-8000-000000000001'
export const LINE = '20000000-0000-4000-8000-000000000001'
export const LINE_2 = '20000000-0000-4000-8000-000000000002'
export const POSITION = '30000000-0000-4000-8000-000000000001'
export const CHILD = '30000000-0000-4000-8000-000000000002'
export const CUSTOMER = '40000000-0000-4000-8000-000000000001'
export const CASE = '50000000-0000-4000-8000-000000000001'

export const MARKET = { id: 'm-de', code: 'DE', currency: 'EUR', minor_unit: 2, time_zone: 'Europe/Berlin' } as const

export function profile(overrides: Partial<PortalProfile> = {}): PortalProfile {
  return {
    participant_id: 'p-a', display_name: 'Dana Example', external_ref: 'DE-A', pseudonymised: false, market: MARKET,
    positions: [{ id: POSITION, position_ref: 'DE-A-1', status: 'active', market_code: 'DE' }],
    can_sponsor: true, has_downline: false, terminated: false, ...overrides,
  }
}

export function portalMe(overrides: Partial<PortalMe> = {}, team = false): PortalMe {
  return {
    realm: 'portal',
    user: { id: 'u-a', email: 'de-a@example.test', display_name: 'Dana Example' },
    tenant: { slug: 'acme', legal_name: 'Acme Ltd' },
    participant: profile({ has_downline: team }),
    mfa: { required: false, enrolled: false, verified: false },
    step_up_at: null,
    navigation: [
      { key: 'home', path: '/portal', label: 'Home' },
      { key: 'earnings', path: '/portal/earnings', label: 'Earnings' },
      { key: 'rank', path: '/portal/rank', label: 'Rank' },
      team ? { key: 'team', path: '/portal/team', label: 'Team' } : { key: 'customers', path: '/portal/customers', label: 'Customers' },
      { key: 'more', path: '/portal/more', label: 'More' },
    ],
    ...overrides,
  }
}

/** Renders inside the real providers with a signed-in distributor (as PortalShell provides). */
export function renderPortal(ui: ReactElement, fetchMock: FetchMock, me: PortalMe = portalMe(), unread: number | null = 0): RenderResult {
  const portal: Portal = { me, profile: me.participant!, zone: MARKET.time_zone, unread, refreshUnread: () => undefined }
  return renderWithProviders(<PortalProvider value={portal}>{ui}</PortalProvider>, fetchMock)
}

/** A list answer with its meta (next_cursor, unread_count). */
export const page = (data: unknown, meta: Record<string, unknown> = {}): Response => json(200, { data, meta: { next_cursor: null, ...meta } })

const PERIOD = { id: 'per-3', starts_at: '2026-08-01T00:00:00.000Z', ends_at: '2026-09-01T00:00:00.000Z' }
const MONEY = { code: 'DE', currency: 'EUR', minor_unit: 2 }

export const SUMMARY: StatementSummary = {
  run_id: RUN, period: { ...PERIOD, state: 'paid' }, market: MONEY, committed_at: '2026-09-02T08:00:00.000Z', net_minor: '2300', payout_state: 'settled',
}

export function statement(overrides: Partial<Statement> = {}): Statement {
  return {
    run_id: RUN, period: { ...PERIOD, state: 'paid' }, market: MONEY, committed_at: '2026-09-02T08:00:00.000Z',
    positions: [{
      position_id: POSITION, position_ref: 'DE-A-1', paid_as: [{ ladder: 'main', rank: 'Silver' }], total_minor: '2300',
      bonuses: [{ rule_key: 'unilevel', rule_name: ENGINE_RULE, total_minor: '2300', lines: [{ id: LINE, amount_minor: '2300', origin_kind: 'none', original_period_id: null }] }],
    }],
    person_total_minor: '2300',
    summary: { gross_minor: '2300', adjustment_minor: '0', clawback_minor: '0', withheld_minor: '0', net_minor: '2300' },
    payout: { instructions: [{ amount_minor: '2300', state: 'settled', terminal_at: '2026-09-05T10:00:00.000Z', masked: 'DE•• 3000' }], blockers: [] },
    ...overrides,
  }
}
