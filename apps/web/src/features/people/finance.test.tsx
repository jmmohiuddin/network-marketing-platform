// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { bankBody, bankErrors, ibanValid, taxBody, type BankForm } from './finance-dialogs'
import { ParticipantRecord } from './participant-record'
import type { ParticipantDetail } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/people/p1',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const AT = '2026-11-17T09:00:00.000Z'
const MARKET = { id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const DETAIL: ParticipantDetail = {
  id: 'p1', external_ref: 'DE-B', account_type: 'individual', market: { id: 'm1', code: 'DE' }, display_name: null, contact_masked: null, status: 'active',
  merged_into: null, enrolled_at: AT, types: [], agreements: [], positions: [], duplicate_hold: false,
}
const SUPPORT = adminMe({ permissions: ['participant.read', 'case.bank_detail.read', 'case.bank_detail.create'] })
const FINANCE = adminMe({ permissions: ['participant.read', 'tax.manage', 'participant.unmask', 'ledger.read'] })
const PAYOUT = adminMe({ permissions: ['participant.read', 'payout.read', 'payout.hold'], roles: [{ assignment_id: 'a1', role_id: 'r1', name: 'Payout officer', market_ids: null }] })
const READER = adminMe({ permissions: ['participant.read'] })
const VALID_IBAN = 'DE89370400440532013000'

function routes(extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/participants/p1': () => ok(DETAIL),
    'GET /v1/markets': () => ok([MARKET]),
    'GET /v1/participants/p1/bank-details': () => ok({
      current: { id: 'v2', scheme: 'iban', masked: '•••• 3000', created_via: 'case', cooling_off_until: '2026-11-20T09:00:00.000Z', in_cooling_off: true, created_at: AT },
      history: [{ id: 'v1', scheme: 'iban', masked: '•••• 1111', created_via: 'migration', cooling_off_until: null, in_cooling_off: false, created_at: '2026-01-01T00:00:00.000Z', superseded_at: AT }],
    }),
    'GET /v1/participants/p1/tax-profile': () => ok({ current: { id: 't1', residency: 'DE', entity_type: 'individual', tax_id_masked: '•••• 6789', valid_from: AT, valid_to: null }, history: [] }),
    'GET /v1/payees/p1/holds': () => ok([]),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.push.mockReset()
})

describe('bank and tax helpers', () => {
  const form: BankForm = { scheme: 'iban', account_holder: 'DE-B', iban: 'de89 3704 0044 0532 0130 00', bic: '', account_number: '', bank_code: '', contact_email: '' }

  it('checks IBANs by mod 97 and sends only the chosen scheme’s fields', () => {
    expect(ibanValid(VALID_IBAN)).toBe(true)
    expect(ibanValid('DE89370400440532013001')).toBe(false)
    expect(bankErrors({ ...form, iban: 'DE89370400440532013001' }).iban).toMatch(/check digits/)
    expect(bankBody(form)).toEqual({ scheme: 'iban', account_holder: 'DE-B', iban: VALID_IBAN })
    expect(bankBody({ ...form, scheme: 'local', account_number: '1234', bank_code: '99', contact_email: 'b@example.test' }))
      .toEqual({ scheme: 'local', account_holder: 'DE-B', account_number: '1234', bank_code: '99', contact_email: 'b@example.test' })
  })

  it('sends only changed tax fields, the tax id normalised', () => {
    expect(taxBody({ residency: 'de', entity_type: 'individual', tax_id: '' }, { residency: 'DE', entity_type: 'individual' })).toBeNull()
    expect(taxBody({ residency: 'NL', entity_type: 'individual', tax_id: 'de 123 456 789' }, { residency: 'DE', entity_type: 'individual' })).toEqual({ residency: 'NL', tax_id: 'DE123456789' })
  })
})

describe('SC-09 Banking', () => {
  it('shows the masked account, the cooling-off chip and earlier accounts; no change control without permission', async () => {
    navigation.search = 'tab=banking'
    renderAs(READER, <ParticipantRecord participantId="p1" />, routes())
    const card = await screen.findByTestId('banking')
    expect(await within(card).findByText('•••• 3000')).toBeTruthy()
    expect(within(card).getByText(/^Cooling off until/)).toBeTruthy()
    expect(await screen.findByText('•••• 1111')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Request bank-detail change' })).toBeNull()
    expect(document.body.textContent).not.toContain(VALID_IBAN)
  })

  it('refuses a wrong IBAN inline, records the request, then opens the case with evidence', async () => {
    navigation.search = 'tab=banking'
    const fetchMock = routes({
      'POST /v1/participants/p1/bank-detail-requests': () => ok({ request_id: '00000000-0000-4000-8000-0000000000aa', masked: '•••• 3000', shared_with_count: 0 }, 201),
      'GET /v1/documents/limits': () => ok({ max_file_bytes: 1048576, types: ['application/pdf'] }),
      'POST /v1/cases': () => ok({ id: 'case-b', state: 'open' }, 201),
      'POST /v1/documents': () => ok({ id: 'doc-1', file_name: 'request.pdf' }, 201),
      'POST /v1/cases/case-b/evidence': () => ok({ id: 'e1' }, 201),
    })
    renderAs(SUPPORT, <ParticipantRecord participantId="p1" />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Request bank-detail change' }))
    const dialog = await screen.findByRole('dialog', { name: 'Request bank-detail change' })
    await userEvent.type(within(dialog).getByLabelText('Account holder'), 'DE-B')
    await userEvent.type(within(dialog).getByLabelText(/^IBAN/), 'DE89370400440532013001')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record new details' }))
    expect(within(dialog).getAllByText('Enter a valid IBAN: its check digits do not match.').length).toBeGreaterThan(0)
    expect(callsTo(fetchMock, 'POST', '/v1/participants/p1/bank-detail-requests')).toHaveLength(0)
    await userEvent.clear(within(dialog).getByLabelText(/^IBAN/))
    await userEvent.type(within(dialog).getByLabelText(/^IBAN/), VALID_IBAN)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record new details' }))
    const caseDialog = await screen.findByRole('dialog', { name: 'Open the bank-detail case' })
    expect(caseDialog.textContent).toContain('•••• 3000')
    const [, init] = callsTo(fetchMock, 'POST', '/v1/participants/p1/bank-detail-requests')[0]!
    expect(bodyOf(init)).toEqual({ scheme: 'iban', account_holder: 'DE-B', iban: VALID_IBAN })
    expect(headerOf(init, 'idempotency-key')).not.toBeNull()
    await userEvent.selectOptions(within(caseDialog).getByLabelText('Reason'), 'PAYEE_REQUEST')
    await userEvent.upload(within(caseDialog).getByLabelText(/Evidence/), new File(['%PDF'], 'request.pdf', { type: 'application/pdf' }))
    await userEvent.click(within(caseDialog).getByRole('button', { name: 'Open bank-detail case' }))
    await vi.waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith('/cases/case-b'))
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/cases')[0]![1])).toMatchObject({
      type: 'bank_detail', subject_type: 'participant', subject_id: 'p1', reason_code: 'PAYEE_REQUEST', payload: { request_id: '00000000-0000-4000-8000-0000000000aa' },
    })
  })

  it('links a refused field from the server (BANK_DETAILS_INVALID) to its input', async () => {
    navigation.search = 'tab=banking'
    renderAs(SUPPORT, <ParticipantRecord participantId="p1" />, routes({
      'POST /v1/participants/p1/bank-detail-requests': () => apiError(422, 'BANK_DETAILS_INVALID', 'The bank details are not valid (bic).', { path: 'bic' }),
    }))
    await userEvent.click(await screen.findByRole('button', { name: 'Request bank-detail change' }))
    const dialog = await screen.findByRole('dialog', { name: 'Request bank-detail change' })
    await userEvent.type(within(dialog).getByLabelText('Account holder'), 'DE-B')
    await userEvent.type(within(dialog).getByLabelText(/^IBAN/), VALID_IBAN)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record new details' }))
    const link = await within(dialog).findByRole('link', { name: /is not valid/ })
    expect(link.getAttribute('href')).toBe('#bank-bic')
  })
})

describe('SC-09 Tax', () => {
  it('shows the masked id; edits with tax.manage and shows the tax id once with participant.unmask', async () => {
    navigation.search = 'tab=tax'
    const fetchMock = routes({
      'POST /v1/participants/p1/tax-profile/unmask': () => ok({ tax_id: 'DE123456789' }),
      'PUT /v1/participants/p1/tax-profile': () => ok({ id: 't2' }),
    })
    renderAs(FINANCE, <ParticipantRecord participantId="p1" />, fetchMock)
    const card = await screen.findByTestId('tax')
    expect(await within(card).findByText('•••• 6789')).toBeTruthy()
    await userEvent.click(within(card).getByRole('button', { name: 'Show tax id' }))
    const unmask = await screen.findByRole('dialog', { name: 'Show tax id' })
    await userEvent.click(within(unmask).getByRole('button', { name: 'Show tax id' }))
    const value = await within(unmask).findByText('DE123456789')
    expect(value.tagName).toBe('DD')
    expect(value.getAttribute('aria-label')).toBeNull()
    expect(value.previousElementSibling?.textContent).toBe('Tax id')
    expect(document.activeElement).toBe(value)
    await userEvent.click(within(unmask).getByRole('button', { name: 'Hide and close' }))
    expect(screen.queryByText('DE123456789')).toBeNull()
    await userEvent.click(within(card).getByRole('button', { name: 'Edit tax profile' }))
    const edit = await screen.findByRole('dialog', { name: 'Edit tax profile' })
    await userEvent.type(within(edit).getByLabelText(/New tax id/), 'de 999 999 999')
    await userEvent.click(within(edit).getByRole('button', { name: 'Save new version' }))
    expect(await screen.findByText('Tax profile saved as a new version.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'PUT', '/v1/participants/p1/tax-profile')[0]!
    expect(bodyOf(init)).toEqual({ tax_id: 'DE999999999' })
  })

  it('hints the pack format and names its label when a tax id does not match it (D-BM-07)', async () => {
    navigation.search = 'tab=tax'
    const format = { label: 'FX tax id', pattern: '^FX[0-9]{6}$' }
    const fetchMock = routes({
      'GET /v1/participants/p1/tax-profile': () => ok({ current: null, history: [], format }),
      'PUT /v1/participants/p1/tax-profile': () => apiError(422, 'TAX_ID_FORMAT', 'refused', { label: 'FX tax id' }),
    })
    renderAs(FINANCE, <ParticipantRecord participantId="p1" />, fetchMock)
    await userEvent.click(await within(await screen.findByTestId('tax')).findByRole('button', { name: 'Edit tax profile' }))
    const edit = await screen.findByRole('dialog', { name: 'Edit tax profile' })
    expect(within(edit).getByText(/Format: FX tax id\./)).toBeTruthy()
    await userEvent.type(within(edit).getByLabelText(/New tax id/), 'FX12')
    await userEvent.click(within(edit).getByRole('button', { name: 'Save new version' }))
    expect((await within(edit).findAllByText('This is not a valid FX tax id.')).length).toBeGreaterThan(0)
    expect(callsTo(fetchMock, 'PUT', '/v1/participants/p1/tax-profile')).toHaveLength(0)
    // The server's refusal names the label too (a pattern changed since the page loaded).
    await userEvent.clear(within(edit).getByLabelText(/New tax id/))
    await userEvent.type(within(edit).getByLabelText(/New tax id/), 'FX123456')
    await userEvent.click(within(edit).getByRole('button', { name: 'Save new version' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'PUT', '/v1/participants/p1/tax-profile')).toHaveLength(1))
    expect((await within(edit).findAllByText('This is not a valid FX tax id.')).length).toBeGreaterThan(0)
  })

  it('offers no edit or unmask without their permissions', async () => {
    navigation.search = 'tab=tax'
    renderAs(READER, <ParticipantRecord participantId="p1" />, routes())
    expect(await screen.findByText('•••• 6789')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit tax profile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show tax id' })).toBeNull()
  })
})

describe('SC-09 Holds and Balances', () => {
  it('places and releases a hold with a reason', async () => {
    navigation.search = 'tab=holds'
    let held = false
    const hold = { id: 'h1', market: { id: 'm1', code: 'DE' }, reason: 'E2E hold', placed_by: { id: 'u1', display_name: 'Cora' }, placed_at: AT, released_by: null, released_at: null, release_reason: null }
    const fetchMock = routes({
      'GET /v1/payees/p1/holds': () => ok(held ? [hold] : []),
      'POST /v1/payees/p1/holds': () => {
        held = true
        return ok(hold, 201)
      },
      'POST /v1/payout-holds/h1/release': () => ok({ ...hold, released_at: AT }),
    })
    renderAs(PAYOUT, <ParticipantRecord participantId="p1" />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Place hold' }))
    const dialog = await screen.findByRole('dialog', { name: 'Place payout hold' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Place hold' }))
    expect(callsTo(fetchMock, 'POST', '/v1/payees/p1/holds')).toHaveLength(0)
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'E2E hold')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Place hold' }))
    expect(await screen.findByText('Payout hold placed.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/payees/p1/holds')[0]![1])).toEqual({ market_id: 'm1', reason: 'E2E hold' })
    await userEvent.click(await screen.findByRole('button', { name: 'Release the hold in DE' }))
    const release = await screen.findByRole('dialog', { name: 'Release payout hold (DE)' })
    await userEvent.type(within(release).getByLabelText('Reason'), 'Checked')
    await userEvent.click(within(release).getByRole('button', { name: 'Release hold' }))
    expect(await screen.findByText('Payout hold released.')).toBeTruthy()
  })

  it('offers no Release to a user who prepares payouts in the hold\'s market', async () => {
    navigation.search = 'tab=holds'
    const hold = { id: 'h1', market: { id: 'm1', code: 'DE' }, reason: 'AML review', placed_by: { id: 'u2', display_name: 'Cora' }, placed_at: AT, released_by: null, released_at: null, release_reason: null }
    const preparer = adminMe({ permissions: [...PAYOUT.permissions, 'payout.prepare'], roles: PAYOUT.roles })
    renderAs(preparer, <ParticipantRecord participantId="p1" />, routes({ 'GET /v1/payees/p1/holds': () => ok([hold]) }))
    expect(await screen.findByText('AML review')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Place hold' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Release the hold in DE' })).toBeNull()
  })

  it('offers only the markets of the payout.hold scope when placing a hold', async () => {
    const at = { ...MARKET, id: 'm0', code: 'AT', name: 'Austria' }
    navigation.search = 'tab=holds'
    const scoped = adminMe({ permissions: PAYOUT.permissions, roles: [{ assignment_id: 'a1', role_id: 'r1', name: 'Payout officer', market_ids: ['m1'] }] })
    const fetchMock = routes({ 'GET /v1/markets': () => ok([at, MARKET]), 'POST /v1/payees/p1/holds': () => ok({}, 201) })
    renderAs(scoped, <ParticipantRecord participantId="p1" />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Place hold' }))
    const dialog = await screen.findByRole('dialog', { name: 'Place payout hold' })
    const market = within(dialog).getByLabelText('Market')
    await vi.waitFor(() => expect(within(market).getAllByRole('option').map((option) => option.textContent)).toEqual(['Germany (DE)']))
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Scoped')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Place hold' }))
    await vi.waitFor(() => expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/payees/p1/holds')[0]![1])).toEqual({ market_id: 'm1', reason: 'Scoped' }))
  })

  it('shows balances per market with links to the ledger, only with ledger.read', async () => {
    navigation.search = 'tab=balances'
    renderAs(FINANCE, <ParticipantRecord participantId="p1" />, routes({
      'GET /v1/payees/p1/balances': () => ok([{ market: { id: 'm1', code: 'DE', currency: 'EUR' }, payable_minor: '800', in_transit_minor: '0', receivable_minor: '700' }]),
    }))
    const card = await screen.findByTestId('balances')
    expect(await within(card).findByText('8.00 EUR')).toBeTruthy()
    expect(within(card).getByRole('link', { name: '7.00 EUR' }).getAttribute('href')).toBe('/ledger?market=m1&tab=accounts&payee=p1&type=clawback_receivable')
    expect(within(card).getByRole('link', { name: 'DE' }).getAttribute('href')).toBe('/ledger?market=m1&tab=accounts&payee=p1')
    expect(card.textContent).toContain('earnings balance owed by the tenant')
  })

  it('hides the Balances tab without ledger.read', async () => {
    renderAs(READER, <ParticipantRecord participantId="p1" />, routes())
    expect(await screen.findByRole('tab', { name: 'Banking' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Balances' })).toBeNull()
  })

  it('says so when no balance is visible (404)', async () => {
    navigation.search = 'tab=balances'
    renderAs(FINANCE, <ParticipantRecord participantId="p1" />, routes({ 'GET /v1/payees/p1/balances': () => json(404, { error: { code: 'NOT_FOUND', message: 'x', details: null, request_id: 'r' } }) }))
    expect(await screen.findByText('No balance in the markets you can see.')).toBeTruthy()
  })
})
