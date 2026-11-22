// @vitest-environment jsdom
import '../../test/dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, renderAs } from '../admin/test-support'
import { decisionRefusal } from './case-actions'
import { EffectPreview } from './effect-preview'
import { caseTypeInfo } from './format'
import { GenealogyCasePage } from './genealogy-case-page'
import type { CaseRecord } from './types'

const navigation = vi.hoisted(() => ({ search: 'tab=transfer', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/cases/genealogy/new',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const SUPPORT = adminMe({ permissions: ['case.genealogy.read', 'case.genealogy.create', 'genealogy.read', 'participant.read'] })
const NODE = {
  position_id: 'b', position_ref: 'BE-B-1', owner: { participant_id: 'pb', external_ref: 'BE-B', display_name: 'Ben' },
  status: 'active', market_code: 'BE', leg: null, children_count: 0, subtree_count: null,
}
const OWNER = { id: 'pe', external_ref: 'BE-E', display_name: 'Eve', market: { id: 'm1', code: 'BE' }, current_type: null, status: 'active' }

async function choose(label: string, query: string, result: RegExp) {
  await userEvent.type(screen.getByLabelText(label), query)
  await userEvent.click(screen.getByRole('button', { name: `Search ${label.toLowerCase()}` }))
  await userEvent.click(await screen.findByRole('button', { name: result }))
}

describe('SC-08 ownership transfer (D-V1A-06)', () => {
  it('offers the documents of the chosen reason, requires a reference and sends the legal basis', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/documents/limits': () => ok({ max_file_bytes: 1048576, types: ['application/pdf'] }),
      'GET /v1/genealogy/search': () => ok([NODE]),
      'GET /v1/participants': () => ok([OWNER]),
      'POST /v1/cases': () => ok({ id: 'case1' }, 201),
      'POST /v1/documents': () => ok({ id: 'doc1', file_name: 'sale.pdf', mime: 'application/pdf', size_bytes: 4, sha256: 'ab' }, 201),
      'POST /v1/cases/case1/evidence': () => ok({}, 201),
    })
    renderAs(SUPPORT, <GenealogyCasePage />, fetchMock)
    expect(screen.getByText('Evidence is required')).toBeTruthy()
    expect((screen.getByLabelText('Legal basis') as HTMLSelectElement).disabled).toBe(true)
    await choose('Position to transfer', 'BE-B', /Choose BE-B-1/)
    await choose('New owner', 'BE-E', /Choose BE-E/)
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'SALE')
    const kinds = [...(screen.getByLabelText('Legal basis') as HTMLSelectElement).options].filter((option) => !option.disabled).map((option) => option.textContent)
    expect(kinds).toEqual(['Sale agreement', 'Court order'])
    await userEvent.selectOptions(screen.getByLabelText('Legal basis'), 'sale_agreement')
    await userEvent.upload(screen.getByLabelText('Evidence'), new File(['%PDF'], 'sale.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open ownership transfer case' }))
    expect(await screen.findAllByText('Enter the document reference.')).toBeTruthy()
    expect(callsTo(fetchMock, 'POST', '/v1/cases')).toHaveLength(0)

    await userEvent.type(screen.getByLabelText('Document reference'), 'SA-2026-17')
    // A reason that does not allow the chosen document drops it.
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'SUCCESSION')
    expect((screen.getByLabelText('Legal basis') as HTMLSelectElement).value).toBe('')
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'SALE')
    await userEvent.selectOptions(screen.getByLabelText('Legal basis'), 'sale_agreement')
    await userEvent.click(screen.getByRole('button', { name: 'Open ownership transfer case' }))
    await vi.waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith('/cases/case1'))
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/cases')[0]![1])).toMatchObject({
      type: 'transfer', subject_id: 'b', reason_code: 'SALE',
      payload: { to_participant_id: 'pe', legal_basis: { document_kind: 'sale_agreement', reference: 'SA-2026-17' } },
    })
  })

  it('is decided with case.transfer.approve, previews the new owner’s readiness and words NEW_OWNER_NOT_READY', () => {
    expect(caseTypeInfo('transfer')?.decide).toBe('case.transfer.approve')
    const record = {
      type: 'transfer', state: 'submitted', effect_preview: {
        from_owner: { participant_id: 'pb', external_ref: 'BE-B' }, to_owner: { participant_id: 'pd', external_ref: 'BE-D' },
        to_type_can_hold_positions: true, new_owner_ready: { tax_profile: false, bank_detail: true },
      },
    } as unknown as CaseRecord
    render(<EffectPreview record={record} />)
    expect(screen.getByText('The new owner has no tax profile in force: approval will be refused.')).toBeTruthy()
    expect(screen.getByText('The new owner has bank details on record.')).toBeTruthy()
    const refused = decisionRefusal(new ApiError(422, 'NEW_OWNER_NOT_READY', 'x', { missing: ['tax_profile', 'bank_detail'] }, 'r1')) as ApiError
    expect(refused.message).toBe('The new owner still needs a tax profile in force and bank details on record (recorded through the usual change controls) before the transfer can be approved. Nothing was decided.')
  })
})
