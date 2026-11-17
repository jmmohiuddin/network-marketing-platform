// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { json, ok } from '../../test/fetch'
import { adminMe, callsTo, fetchByRoute, renderAs } from '../admin/test-support'
import { periodName } from '../periods/format'
import { countMeasures, factsOf, measureText, ranksText } from './format'
import { QualificationPage } from './qualification-page'
import type { QualificationRow } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/people/par-c/qualification',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const CALENDAR = { id: 'cal1', name: 'DE monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Berlin', market: { id: 'm1', code: 'DE' }, plan: { id: 'pl1', name: 'DE core' } }
const ANALYST = adminMe({ permissions: ['participant.read', 'period.read', 'run.review', 'genealogy.read'] })
const SUPPORT = adminMe({ permissions: ['participant.read'] })
const PARTICIPANT = {
  id: 'par-c', external_ref: 'DE-C', account_type: 'individual', market: { id: 'm1', code: 'DE' }, display_name: 'Cleo C', contact_masked: null, status: 'active',
  merged_into: null, enrolled_at: '2026-08-01T00:00:00.000Z', types: [], positions: [{ id: 'pos-c', position_ref: 'P-C', status: 'active', owned_to: null }], duplicate_hold: false,
}

function row(id: string, month: number, overrides: Partial<QualificationRow> = {}): QualificationRow {
  return {
    period: { id, starts_at: new Date(Date.UTC(2026, month, 1)).toISOString(), ends_at: new Date(Date.UTC(2026, month + 1, 1)).toISOString(), calendar_id: 'cal1' },
    run_id: `r-${id}`, plan_version: { id: 'v1', version: 1 }, paid_as: [{ ladder: 'main', rank: 'R1' }], titles: [{ ladder: 'main', rank: 'R1' }],
    grace_used: [], counters: [], carry: [], one_time_flags: [], banked: [], measures: [{ measure: 'gv', valueMinor: '50000' }, { measure: 'pv', valueMinor: '30000' }],
    ...overrides,
  }
}

const M3 = row('per-m3', 7)
const M2 = row('per-m2', 8, { paid_as: [{ ladder: 'main', rank: null }], measures: [{ measure: 'gv', valueMinor: '20000' }, { measure: 'pv', valueMinor: '0' }], carry: [{ key: 'gv', amountMinor: '1500', periodsHeld: 1 }] })

function routes(rows: readonly QualificationRow[]) {
  return fetchByRoute({
    'GET /v1/participants/par-c': () => ok(PARTICIPANT),
    'GET /v1/periods': () => json(200, { data: { calendars: [CALENDAR], periods: [] }, meta: { next_cursor: null } }),
    'GET /v1/positions/pos-c/qualification': () => ok(rows),
  })
}

beforeEach(() => {
  navigation.search = ''
})

describe('qualification format', () => {
  it('keeps paid-as and title per ladder and values as exact whole minor units while the scale is unknown', () => {
    expect(ranksText([{ ladder: 'main', rank: 'R1' }, { ladder: 'leader', rank: null }])).toBe('main: R1, leader: none')
    expect(measureText(M3, 'pv', null)).toBe((30000).toLocaleString())
    expect(measureText(row('big', 1, { measures: [{ measure: 'pv', valueMinor: '9007199254740993' }] }), 'pv', null)).toBe(9007199254740993n.toLocaleString())
    expect(factsOf(M2, ['pv'], null).find(([label]) => label === 'Carry')?.[1]).toBe(`gv ${(1500).toLocaleString()} (1 held)`)
  })

  it('shows volumes on the market scale and count measures as integers (BUG-090)', () => {
    const scale = { minorUnit: 2, counts: countMeasures([{ rule_key: 'enrolled', kind: 'count.enrolled' }, { rule_key: 'pv', kind: 'volume.personal' }]) }
    const counted = row('c', 1, { measures: [{ measure: 'enrolled', valueMinor: '3' }, { measure: 'pv', valueMinor: '50000' }] })
    expect(measureText(counted, 'pv', scale)).toBe(`${(500).toLocaleString()}.00`)
    expect(measureText(counted, 'enrolled', scale)).toBe('3')
    expect(factsOf(M2, ['pv'], scale).find(([label]) => label === 'Carry')?.[1]).toBe('gv 15.00 (1 held)')
  })
})

describe('QualificationPage (SC-43)', () => {
  it('shows the latest committed measures, the matrix with run links, and compares two periods', async () => {
    const fetchMock = routes([M2, M3])
    renderAs(ANALYST, <QualificationPage participantId="par-c" />, fetchMock)
    expect(await screen.findByRole('heading', { level: 1, name: 'Rank and qualification: Cleo C' })).toBeTruthy()
    const metrics = await screen.findByTestId('metrics')
    expect(metrics.textContent).toContain((20000).toLocaleString())
    const matrix = screen.getByRole('table', { name: 'Qualification by committed period' })
    expect(within(matrix).getByRole('link', { name: 'r-per-m3' }).getAttribute('href')).toBe('/periods/per-m3/runs/r-per-m3/review')
    expect(matrix.textContent).toContain('main: none')
    expect(matrix.textContent).toContain((30000).toLocaleString())
    expect(matrix.textContent).not.toContain('300.00')
    const compare = screen.getByTestId('compare')
    expect(within(compare).getAllByText('Changed').length).toBeGreaterThan(0)
    expect(screen.getByTestId('primary-action').getAttribute('href')).toBe('/genealogy?root=pos-c')
    expect(screen.getByRole('heading', { level: 2, name: `Latest committed period: ${periodName(M2.period.starts_at, M2.period.ends_at, 'Europe/Berlin')}` })).toBeTruthy()
  })

  it('reads measure kinds from the plan version and shows volumes in the market’s decimals (BUG-090)', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/participants/par-c': () => ok(PARTICIPANT),
      'GET /v1/periods': () => json(200, { data: { calendars: [CALENDAR], periods: [] }, meta: { next_cursor: null } }),
      'GET /v1/positions/pos-c/qualification': () => ok([M3]),
      'GET /v1/markets': () => ok([{ id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', minor_unit: 2 }]),
      'GET /v1/plans/pl1/versions/1': () => ok({ rules: [{ rule_key: 'pv', kind: 'volume.personal' }, { rule_key: 'gv', kind: 'volume.group' }] }),
    })
    renderAs(adminMe({ permissions: ['participant.read', 'period.read', 'plan.read'] }), <QualificationPage participantId="par-c" />, fetchMock)
    const metrics = await screen.findByTestId('metrics')
    await vi.waitFor(() => expect(metrics.textContent).toContain('300.00'))
    expect(metrics.textContent).toContain('500.00')
  })

  it('filters by calendar through the URL and sends it to the API', async () => {
    navigation.search = 'position=pos-c&calendar=cal1'
    const fetchMock = routes([M3])
    renderAs(ANALYST, <QualificationPage participantId="par-c" />, fetchMock)
    await screen.findByTestId('metrics')
    expect(new URL(callsTo(fetchMock, 'GET', '/v1/positions/pos-c/qualification')[0]![0], 'http://x').searchParams.get('calendar_id')).toBe('cal1')
    await userEvent.selectOptions(screen.getByLabelText('Calendar'), '')
    expect(navigation.router.replace).toHaveBeenCalledWith('/people/par-c/qualification?position=pos-c')
  })

  it('works without period.read (no calendar choice, exact bounds) and links no run review without run.review', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/participants/par-c': () => ok(PARTICIPANT),
        'GET /v1/positions/pos-c/qualification': () => ok([M3]),
    })
    renderAs(SUPPORT, <QualificationPage participantId="par-c" />, fetchMock)
    const matrix = await screen.findByRole('table', { name: 'Qualification by committed period' })
    expect(await within(matrix).findAllByText('main: R1')).toHaveLength(2) // paid-as and title, separately
    expect(screen.queryByLabelText('Calendar')).toBeNull()
    expect(within(matrix).queryByRole('link')).toBeNull()
    expect(screen.queryByTestId('primary-action')).toBeNull()
    expect(callsTo(fetchMock, 'GET', '/v1/periods')).toHaveLength(0)
    expect(screen.queryByText(/Export|FTC|Invariant/)).toBeNull()
  })
})
