// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, callsTo, fetchByRoute, renderAs } from '../admin/test-support'
import { policySentence } from './downline-view'
import { GenealogyExplorer, treeQueryOf } from './explorer'
import { countsText } from './tree-list'
import type { PositionView, TreeNode } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/genealogy',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const ANALYST = adminMe({ permissions: ['genealogy.read', 'participant.read'] })
const SUPPORT = adminMe({ permissions: ['genealogy.read', 'participant.read', 'case.genealogy.create'] })
const CURRENT = { source: 'read_model', state: 'current', stale_since: null, version: '4' }

/** A UUID per reference: the explorer ignores ids in the URL that are not UUIDs. */
const uid = (ref: string): string => `00000000-0000-4000-8000-${[...ref].map((char) => char.charCodeAt(0).toString(16)).join('').padStart(12, '0')}`

function node(ref: string, overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    position_id: uid(ref), position_ref: ref, owner: { participant_id: `p-${ref}`, external_ref: `EXT-${ref}`, display_name: `Owner ${ref}` },
    status: 'active', market_code: 'NL', leg: null, children_count: 0, subtree_count: 0, ...overrides,
  }
}

const POSITION: PositionView = {
  id: uid('A'), position_ref: 'A', market: { id: 'm1', code: 'NL' }, status: 'active', status_from: '2026-11-01T00:00:00.000Z',
  owner: { participant_id: 'p-A', external_ref: 'EXT-A', display_name: 'Owner A' },
  ownership: [{ participant: { id: 'p-A', external_ref: 'EXT-A', display_name: 'Owner A' }, valid_from: '2026-11-01T00:00:00.000Z', valid_to: null, case_id: null }],
  status_history: [{ from_status: null, to_status: 'active', effective_from: '2026-11-01T00:00:00.000Z', reason: 'Enrolment', case_id: null, recorded_at: '2026-11-01T00:00:00.000Z' }],
  parents: { sponsor: null, placement: null },
}

const tree = (data: unknown, meta: Record<string, unknown> = { next_cursor: null, read_model: CURRENT }) => json(200, { data, meta })

beforeEach(() => {
  navigation.search = ''
  navigation.router.replace.mockClear()
})

describe('GenealogyExplorer (SC-07)', () => {
  it('lists top-level positions and focuses one by URL', async () => {
    const user = userEvent.setup()
    renderAs(ANALYST, <GenealogyExplorer />, fetchByRoute({ 'GET /v1/genealogy/tree': () => tree({ focus: null, breadcrumbs: [], breadcrumbs_truncated: false, children: [node('A', { children_count: 2, subtree_count: 3 })] }) }))
    expect(await screen.findByText('Read model version 4 is current.')).toBeTruthy()
    expect(screen.getByText('2 direct · 3 positions in subtree')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Focus A' }))
    expect(navigation.router.replace).toHaveBeenLastCalledWith(`/genealogy?root=${uid('A')}`)
    // Must-not-implement items of SC-07 (PLAN B2 5).
    expect(screen.queryByText(/Graphic|Path Audit|Tree Config|Export|Sign & Authorize|Unmask|volume|rank/i)).toBeNull()
  })

  it('shows breadcrumbs, the focused card, lazily loaded children and the inspector', async () => {
    const user = userEvent.setup()
    navigation.search = `root=${uid('A')}`
    const fetchMock = fetchByRoute({
      'GET /v1/genealogy/tree': (query) => (query.get('root') === uid('A')
        ? tree({ focus: node('A', { children_count: 1, subtree_count: 2 }), breadcrumbs: [node('ROOT')], breadcrumbs_truncated: false, children: [node('B', { children_count: 1, leg: '1' })] })
        : tree({ focus: node('B'), breadcrumbs: [], breadcrumbs_truncated: false, children: [node('C')] })),
      [`GET /v1/positions/${uid('A')}`]: () => ok({
        ...POSITION,
        parents: {
          sponsor: { position_id: uid('ROOT'), position_ref: 'ROOT', valid_from: '2026-11-10T00:00:00.000000Z', event_type: 'rule', rule_id: '11111111-1111-4111-8111-111111111111:reparent' },
          placement: { position_id: uid('ROOT'), position_ref: 'ROOT', valid_from: '2026-11-01T00:00:00.000000Z', event_type: 'enrolment', rule_id: null, leg: '1' },
        },
      }),
    })
    renderAs(SUPPORT, <GenealogyExplorer />, fetchMock)
    expect(within(await screen.findByTestId('focus-node')).getByRole('heading', { name: 'Owner A' })).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Path to the top of the tree' })).getByRole('button', { name: /Owner ROOT/ })).toBeTruthy()
    expect(callsTo(fetchMock, 'GET', '/v1/genealogy/tree')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Show the 1 position under B' }))
    expect(await screen.findByText('Owner C')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide the 1 position under B' }).getAttribute('aria-expanded')).toBe('true')
    const inspector = await screen.findByRole('complementary', { name: 'Position A' })
    expect(within(inspector).getByRole('link', { name: 'Open participant record' }).getAttribute('href')).toBe('/people/p-A')
    expect(within(inspector).getByRole('link', { name: 'Request change' }).getAttribute('href')).toBe(`/cases/genealogy/new?position=${uid('A')}`)
    // BUG-088: a re-parent by the plan names the rule; the placement says how it was made.
    expect(within(inspector).getByText(/^By plan rule “reparent”, since /)).toBeTruthy()
    expect(within(inspector).getByText(/^At enrolment, since /)).toBeTruthy()
  })

  it('reads a past date from the system of record and passes known-at as an instant', async () => {
    navigation.search = 'asOf=2026-11-16&knownAt=2026-11-16T10:00&kind=placement'
    const fetchMock = fetchByRoute({
      'GET /v1/genealogy/tree': () => tree({ focus: null, breadcrumbs: [], breadcrumbs_truncated: false, children: [] }, { next_cursor: null, read_model: { ...CURRENT, source: 'system_of_record' } }),
    })
    renderAs(ANALYST, <GenealogyExplorer />, fetchMock)
    expect(await screen.findByText('Read from the system of record')).toBeTruthy()
    expect(screen.getByText('No position in this tree at that date.')).toBeTruthy()
    const query = new URL(callsTo(fetchMock, 'GET', '/v1/genealogy/tree')[0]![0], 'http://x').searchParams
    expect([query.get('kind'), query.get('as_of'), query.get('known_at')]).toEqual(['placement', new Date('2026-11-16T23:59:59.999').toISOString(), new Date('2026-11-16T10:00').toISOString()])
  })

  it('warns while the read model is stale', async () => {
    renderAs(ANALYST, <GenealogyExplorer />, fetchByRoute({
      'GET /v1/genealogy/tree': () => tree({ focus: null, breadcrumbs: [], breadcrumbs_truncated: false, children: [node('A', { subtree_count: null })] }, { next_cursor: null, read_model: { ...CURRENT, state: 'stale', source: 'system_of_record', stale_since: '2026-11-17T08:00:00.000Z' } }),
    }))
    expect(await screen.findByText('The tree changed and is being rebuilt')).toBeTruthy()
    expect(screen.getByText('0 direct')).toBeTruthy()
  })

  it('searches and focuses a result', async () => {
    const user = userEvent.setup()
    renderAs(ANALYST, <GenealogyExplorer />, fetchByRoute({
      'GET /v1/genealogy/tree': () => tree({ focus: null, breadcrumbs: [], breadcrumbs_truncated: false, children: [] }),
      'GET /v1/genealogy/search': (query) => ok(query.get('q') === 'Owner' ? [node('A')] : []),
    }))
    await user.type(await screen.findByLabelText('Find a position'), 'Owner')
    await user.click(screen.getAllByRole('button', { name: 'Search' })[0]!)
    await user.click(await screen.findByRole('button', { name: 'Focus A' }))
    expect(navigation.router.replace).toHaveBeenLastCalledWith(`/genealogy?root=${uid('A')}`)
  })

  it('views as a distributor: the policy, named children and counts beyond', async () => {
    navigation.search = `viewer=${uid('A')}`
    const fetchMock = fetchByRoute({
      [`GET /v1/positions/${uid('A')}`]: () => ok(POSITION),
      [`GET /v1/positions/${uid('A')}/downline`]: () => tree({
        node: { position_id: uid('A'), depth: 0, display_name: 'Owner A', position_ref: 'A', status: 'active', enrolled_on: '2026-11-01', external_ref: 'EXT-A', market_code: 'NL' },
        children: [{ position_id: uid('B'), depth: 1, display_name: 'Owner B', position_ref: 'B', status: 'active', enrolled_on: '2026-11-02' }],
        aggregates: [{ depth: 2, count: 1 }],
        policy: { version_id: null, named_depth: 1, contact_for_personally_sponsored: false, default: true },
      }),
    })
    renderAs(ANALYST, <GenealogyExplorer />, fetchMock)
    const view = await screen.findByTestId('downline-view')
    expect(await within(view).findByText('Viewing as A')).toBeTruthy()
    expect(within(view).getByText(/names 1 level below the distributor/)).toBeTruthy()
    expect(within(view).getByText(/platform safe default applies/)).toBeTruthy()
    expect(within(view).getByText('Owner B')).toBeTruthy()
    expect(within(view).getByText('1 position')).toBeTruthy()
    expect(new URL(callsTo(fetchMock, 'GET', `/v1/positions/${uid('A')}/downline`)[0]![0], 'http://x').searchParams.get('viewer')).toBe(uid('A'))
    expect(callsTo(fetchMock, 'GET', '/v1/genealogy/tree')).toHaveLength(0)
  })

  it('hides the tree kind and dates while viewing as a distributor: the downline is the sponsor tree now', async () => {
    navigation.search = `viewer=${uid('A')}&kind=placement&asOf=2026-11-01&knownAt=2026-11-02T10:00`
    const fetchMock = fetchByRoute({
      [`GET /v1/positions/${uid('A')}`]: () => ok(POSITION),
      [`GET /v1/positions/${uid('A')}/downline`]: () => tree({ node: null, children: [], aggregates: [], policy: { version_id: null, named_depth: 1, contact_for_personally_sponsored: false, default: true } }),
    })
    renderAs(ANALYST, <GenealogyExplorer />, fetchMock)
    const view = await screen.findByTestId('downline-view')
    // "in force", not "approved": an approved policy may be scheduled for later while the default applies (BUG-079).
    expect(await within(view).findByText(/No tenant policy is in force yet: the platform safe default applies\./)).toBeTruthy()
    const settings = screen.getByRole('region', { name: 'Explorer settings' })
    expect(within(settings).getByText(/always shows the sponsor tree as it is now/)).toBeTruthy()
    expect(within(settings).queryByText('Placement tree')).toBeNull()
    expect(within(settings).queryByLabelText(/As of/)).toBeNull()
    expect(within(settings).queryByLabelText(/Known at/)).toBeNull()
    expect(within(settings).getByLabelText('Find a position')).toBeTruthy()
    expect(new URL(callsTo(fetchMock, 'GET', `/v1/positions/${uid('A')}/downline`)[0]![0], 'http://x').searchParams.get('kind')).toBe('sponsor')
  })

  it('ignores a viewer or root in the URL that is not a position id, so it never reaches an API path', async () => {
    navigation.search = 'viewer=..%2Fparticipants%2Fp1&root=..'
    const fetchMock = fetchByRoute({ 'GET /v1/genealogy/tree': () => tree({ focus: null, breadcrumbs: [], breadcrumbs_truncated: false, children: [] }) })
    renderAs(ANALYST, <GenealogyExplorer />, fetchMock)
    expect(await screen.findByText('No position in this tree at that date.')).toBeTruthy()
    expect(fetchMock.mock.calls.map(([input]) => String(input).split('?')[0])).toEqual(['/v1/genealogy/tree'])
    expect(new URL(callsTo(fetchMock, 'GET', '/v1/genealogy/tree')[0]![0], 'http://x').searchParams.get('root')).toBeNull()
  })

  it('says "not found" for a position outside the distributor’s downline', async () => {
    navigation.search = `viewer=${uid('A')}&root=${uid('Z')}`
    renderAs(ANALYST, <GenealogyExplorer />, fetchByRoute({
      [`GET /v1/positions/${uid('A')}`]: () => ok(POSITION),
      [`GET /v1/positions/${uid('Z')}/downline`]: () => apiError(404, 'NOT_FOUND'),
    }))
    expect(await screen.findByText('Not found or not available to you')).toBeTruthy()
  })
})

describe('genealogy helpers', () => {
  it('checks the bitemporal parameters', () => {
    const now = Date.parse('2026-11-17T12:00:00.000Z')
    const base = { kind: 'sponsor' as const, root: null, viewer: null }
    expect(treeQueryOf({ ...base, asOf: '', knownAt: '2026-11-16T10:00' }, now).problem).toMatch(/as-of date first/)
    expect(treeQueryOf({ ...base, asOf: '2026-11-16', knownAt: '2099-01-01T00:00' }, now).problem).toBe('Known-at cannot be in the future.')
    expect(treeQueryOf({ ...base, asOf: '2026-11-16', knownAt: '' }, now)).toEqual({ query: { kind: 'sponsor', as_of: new Date('2026-11-16T23:59:59.999').toISOString() }, problem: null })
    expect(treeQueryOf({ ...base, asOf: '2026-02-31', knownAt: '' }, now).problem).toBe('Enter the as-of date as a date.')
  })

  it('reads the as-of date as the end of that local day, so today includes today’s enrolments', () => {
    const now = new Date()
    const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-')
    const asOf = treeQueryOf({ kind: 'sponsor', root: null, viewer: null, asOf: today, knownAt: '' }, now.getTime()).query.as_of
    expect(Date.parse(asOf!)).toBeGreaterThanOrEqual(now.getTime())
    expect(new Date(asOf!).getDate()).toBe(now.getDate())
    expect(treeQueryOf({ kind: 'sponsor', root: null, viewer: null, asOf: '16-11-2026', knownAt: '' }).problem).toBe('Enter the as-of date as a date.')
  })

  it('words counts and the policy', () => {
    expect(countsText({ children_count: 1, subtree_count: null })).toBe('1 direct')
    expect(policySentence({ version_id: 'v', named_depth: 2, contact_for_personally_sponsored: true, default: false })).toMatch(/names 2 levels below.*shown masked/)
  })
})
