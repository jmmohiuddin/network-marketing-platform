// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { json, ok } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { mappingPath } from './batch-mapping'
import { findingText } from './batch-findings'
import { ComplianceKpis } from './compliance-kpis'
import { MappingEditor } from './mapping-editor'
import { NewImportForm } from './new-import-form'
import { callsOf, fetchRoutes, withSession } from './test-support'

const navigation = vi.hoisted(() => ({ search: '', router: { push: vi.fn(), replace: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation.router, usePathname: () => '/imports/new', useSearchParams: () => new URLSearchParams(navigation.search) }))

const MARKETS = [
  { id: 'm-de', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live' },
  { id: 'm-at', code: 'AT', name: 'Austria', currency: 'EUR', state: 'draft' },
]
const importRoutes = () => fetchRoutes(
  ['GET', /^\/v1\/markets$/, () => ok(MARKETS)],
  ['GET', /^\/v1\/imports\/limits$/, () => ok({ max_file_bytes: 1_000_000 })],
)

describe('SC-24 touch: migration imports (D-B6-09)', () => {
  it('words a genealogy cycle with its members in chain order', () => {
    expect(findingText({ code: 'GENEALOGY_CYCLE', detail: "sponsor cycle: 'AT-A' -> 'AT-C' -> 'AT-B' -> 'AT-A'" })).toBe('Genealogy cycle: AT-A → AT-C → AT-B → AT-A')
    expect(findingText({ code: 'ORPHAN_REFERENCE', detail: "participant 'AT-B': sponsor_id 'X' not in participants.csv" })).toBe("participant 'AT-B': sponsor_id 'X' not in participants.csv")
    expect(findingText({ code: 'GENEALOGY_CYCLE', detail: null })).toBe('—')
  })

  it('opens the mapping of a batch with its kind', () => {
    expect(mappingPath({ id: 'b1', kind: 'migration' })).toBe('/imports/mappings?batch=b1&kind=migration')
    expect(mappingPath({ id: 'b1', kind: 'overlay' })).toBe('/imports/mappings?batch=b1')
  })

  it('offers the kind only to migration.manage holders and lists only draft markets for a migration', async () => {
    navigation.search = 'kind=migration'
    renderWithProviders(withSession(<NewImportForm />, ['import.manage', 'migration.manage']), importRoutes())
    const kind = await screen.findByRole('group', { name: 'Kind of import' })
    expect((within(kind).getByLabelText(/^Migration/) as HTMLInputElement).checked).toBe(true)
    await screen.findByRole('option', { name: 'Austria (AT)' })
    expect(screen.queryByRole('option', { name: 'Germany (DE)' })).toBeNull()
    await userEvent.click(within(kind).getByLabelText(/^Compliance overlay/))
    expect(await screen.findByRole('option', { name: 'Germany (DE)' })).toBeTruthy()
  })

  it('shows no kind choice without migration.manage, even with ?kind=migration', async () => {
    navigation.search = 'kind=migration'
    renderWithProviders(withSession(<NewImportForm />, ['import.manage']), importRoutes())
    expect(await screen.findByRole('option', { name: 'Germany (DE)' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Kind of import' })).toBeNull()
  })

  it('lists and saves only migration mappings when opened from a migration batch', async () => {
    navigation.search = 'kind=migration'
    const fetchMock = fetchRoutes(['GET', /^\/v1\/import-mappings\?/, () => json(200, { data: [], meta: { latest_version: 0, next_cursor: null } })])
    renderWithProviders(withSession(<MappingEditor />, ['mapping.edit', 'migration.manage']), fetchMock)
    expect(await screen.findByRole('heading', { name: 'Migration mapping' })).toBeTruthy()
    expect(callsOf(fetchMock)[0]).toContain('kind=migration')
  })

  it('lets an approver switch to the migration mappings (BUG-122)', async () => {
    navigation.search = ''
    navigation.router.replace.mockClear()
    const fetchMock = fetchRoutes(['GET', /^\/v1\/import-mappings\?/, () => json(200, { data: [], meta: { latest_version: 0, next_cursor: null } })])
    renderWithProviders(withSession(<MappingEditor />, ['mapping.approve']), fetchMock)
    const kind = await screen.findByLabelText('Mapping')
    expect((kind as HTMLSelectElement).value).toBe('overlay')
    await userEvent.selectOptions(kind, 'migration')
    expect(navigation.router.replace).toHaveBeenCalledWith('/imports/new?kind=migration')
  })
})

describe('SC-46 touch: compliance counts', () => {
  it('shows guardrail warnings and open cases by type with their definitions', async () => {
    const fetchMock = fetchRoutes(['GET', /^\/v1\/dashboards\/compliance$/, () => json(200, {
      data: { guardrail_warnings: 2, open_cases: [{ type: 'restatement', count: 1 }, { type: 'privacy', count: 3 }], overdue_cases: 1 },
      meta: { definitions: [
        { key: 'guardrail_warnings', label: 'Guardrail warnings', definition: 'Outstanding guardrail decisions.', source: 's' },
        { key: 'open_cases', label: 'Open cases', definition: 'Cases not yet decided.', source: 's' },
        { key: 'overdue_cases', label: 'Overdue cases', definition: 'Submitted cases past their due time.', source: 's' },
      ] },
    })])
    renderWithProviders(withSession(<ComplianceKpis />, ['compliance.read', 'guardrail.read']), fetchMock)
    const cards = await screen.findByTestId('compliance-kpis')
    expect(await within(cards).findByText('Outstanding guardrail decisions.')).toBeTruthy()
    expect(within(cards).getByText('4')).toBeTruthy()
    const byType = within(cards).getByRole('list', { name: 'Open cases by type' })
    expect(byType.textContent).toContain('Restatement: 1')
    expect(byType.textContent).toContain('Privacy request: 3')
    expect(within(cards).getByText(/1 overdue case\./)).toBeTruthy()
    expect(within(cards).getByRole('link', { name: 'Open guardrails' }).getAttribute('href')).toBe('/compliance/guardrails')
  })
})
