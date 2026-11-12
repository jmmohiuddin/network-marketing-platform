// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { ComplianceOverview, latestPerMarket } from './compliance-overview'
import { fetchRoutes, withSession } from './test-support'
import type { Snapshot } from './types'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/compliance', useSearchParams: () => new URLSearchParams('') }))

const MARKET_DE = '0193a1b2-0000-7000-8000-00000000000d'
const MARKET_FR = '0193a1b2-0000-7000-8000-00000000000f'

function snapshot(id: string, market: string, state: Snapshot['state'], extra: Partial<Snapshot> = {}): Snapshot {
  return {
    id, state, market_id: market, period_from: '2025-01', period_to: '2025-12', method_version: 'cpl-method-1.0.0', failure_reason: null,
    created_at: '2026-11-01T10:00:00Z', reports: ['R1', 'R5'], input_batch_ids: ['b1', 'b2'], input_mapping_versions: [3], ...extra,
  }
}

const figure = (period: string, value: string) => ({
  id: `R1.${period}.customer_share_pct`, key: 'customer_share_pct', unit: 'percent', value, numerator: '600', denominator: '1000',
  population: 'Orders with a known buyer type', population_count: 40, method: 'Net sales of customer orders over net sales.', method_version: 'cpl-method-1.0.0', note: null,
})

const detail = {
  ...snapshot('s2', MARKET_DE, 'ready'),
  input_data_quality: [{ batch_id: 'b1', data_quality: { orders: 40, orders_unknown_purpose: 3, refunded_orders: 0, refunds_without_month: 0, payout_lines: 0, payout_lines_without_source_order: 0, payout_lines_unknown_source_kind: 0, unmapped: { purposes: [], source_kinds: [] } } }],
  results: [
    { report: 'R1', period: '2025-11', period_kind: 'month', partial: false, notes: [], figures: [figure('2025-11', '55.00')], omitted: [] },
    { report: 'R1', period: '2025-12', period_kind: 'month', partial: false, notes: [], figures: [figure('2025-12', '60.00')], omitted: [] },
    { report: 'R5', period: '2025', period_kind: 'year', partial: false, notes: [], figures: [], omitted: [{ key: 'earned_more_than_zero_pct', reason: 'No payout lines were loaded.' }] },
  ],
}

const list = (rows: readonly Snapshot[]) => () => json(200, { data: rows, meta: { next_cursor: null } })

describe('latestPerMarket', () => {
  it('keeps, per market, the newest snapshot that has figures', () => {
    const rows = [snapshot('s3', MARKET_DE, 'computing'), snapshot('s2', MARKET_DE, 'ready'), snapshot('s1', MARKET_DE, 'ready'), snapshot('s0', MARKET_FR, 'outdated')]
    expect(latestPerMarket(rows).map((row) => row.id)).toEqual(['s2', 's0'])
  })
})

describe('ComplianceOverview (SC-46)', () => {
  afterEach(() => vi.useRealTimers())

  it('shows each market’s latest headline figures with coverage, warnings and data status', async () => {
    const rows = [
      snapshot('s3', MARKET_DE, 'computing'), snapshot('s2', MARKET_DE, 'ready'),
      snapshot('s9', MARKET_FR, 'failed', { failure_reason: 'Inputs changed while computing.' }),
    ]
    const fetchMock = fetchRoutes(
      ['GET', /^\/v1\/compliance\/snapshots\?/, list(rows)],
      ['GET', /^\/v1\/compliance\/snapshots\/s2$/, () => json(200, { data: detail, meta: { notice: 'Indicator figures computed from loaded historical data.' } })],
    )
    renderWithProviders(withSession(<ComplianceOverview />, ['compliance.read', 'snapshot.create', 'import.manage']), fetchMock)
    const market = await screen.findByRole('region', { name: `market ${MARKET_DE} · 2025-01 to 2025-12` })
    const r1 = await within(market).findByRole('article', { name: 'R1 Retail-customer share · 2025-12: Customer share of net sales' })
    expect(within(r1).getByText('60.00 %')).toBeTruthy()
    expect(within(r1).getByRole('link', { name: 'Open the rows behind this figure' }).getAttribute('href')).toBe('/compliance/snapshots/s2/rows?figure=R1.2025-12.customer_share_pct')
    expect(within(market).getByRole('article', { name: /^R5 Earnings distribution · 2025/ }).textContent).toContain('No payout lines were loaded.')
    expect(within(market).getByText(/2 loaded import batch\(es\)/)).toBeTruthy()
    expect(within(market).getByText('3 of 40 orders have an unknown purpose')).toBeTruthy()
    const status = screen.getByRole('region', { name: 'Data status' })
    expect(status.textContent).toContain('1 snapshot(s) being computed')
    expect(status.textContent).toContain(`The newest snapshot of market ${MARKET_FR} (2025-01 to 2025-12) failed: Inputs changed while computing.`)
    expect(screen.getByRole('button', { name: 'Create snapshot' }).className).toContain('btn-primary')
    expect(screen.getByRole('link', { name: 'Open reports' }).getAttribute('href')).toBe('/compliance/snapshots')
    expect(screen.getByRole('link', { name: 'Open imports' }).getAttribute('href')).toBe('/imports')
  })

  it('starts from the imports when there is no snapshot yet', async () => {
    renderWithProviders(withSession(<ComplianceOverview />, ['compliance.read', 'import.manage']), fetchRoutes(['GET', /^\/v1\/compliance\/snapshots\?/, list([])]))
    expect(await screen.findByText(/Upload an export to begin/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create snapshot' })).toBeNull()
  })
})
