// @vitest-environment jsdom
import '../../test/dom'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchReturning } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { NewImportForm } from './new-import-form'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/imports/new', useSearchParams: () => new URLSearchParams('') }))

/** Stands in for XMLHttpRequest: records the request; the test answers it. */
class FakeXhr {
  static sent: FakeXhr[] = []
  readonly upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
  readonly headers: Record<string, string> = {}
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  status = 0
  responseText = ''
  url = ''
  body: FormData | null = null
  open(_method: string, url: string) { this.url = url }
  setRequestHeader(name: string, value: string) { this.headers[name] = value }
  getResponseHeader() { return null }
  send(body: FormData) {
    this.body = body
    FakeXhr.sent.push(this)
  }
  answer(status: number, body: unknown) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 30, total: 30 })
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onload?.()
  }
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Market'), 'DE')
  fireEvent.change(screen.getByLabelText('First month'), { target: { value: '2025-01' } })
  fireEvent.change(screen.getByLabelText('Last month'), { target: { value: '2025-03' } })
  for (const [label, name] of [['Participants file (participants.csv)', 'participants.csv'], ['Orders file (orders.csv)', 'orders.csv'], ['Payout lines file (payout_lines.csv)', 'payout_lines.csv']]) {
    await user.upload(screen.getByLabelText(label!), new File(['a,b\n1,2\n'], name!, { type: '' }))
  }
}

describe('NewImportForm', () => {
  beforeEach(() => {
    FakeXhr.sent = []
    router.push.mockReset()
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })

  it('lists what is missing and sends nothing', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NewImportForm />, fetchReturning())
    fireEvent.change(screen.getByLabelText('First month'), { target: { value: '2025-03' } })
    fireEvent.change(screen.getByLabelText('Last month'), { target: { value: '2025-01' } })
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }))
    const summary = screen.getByRole('alert')
    expect(summary.textContent).toContain('Enter the market code.')
    expect(summary.textContent).toContain('The last month must not be before the first month.')
    expect(summary.textContent).toContain('Choose the payout lines CSV file.')
    expect(FakeXhr.sent).toHaveLength(0)
  })

  it('uploads the three files as CSV with an Idempotency-Key and opens the new batch', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NewImportForm />, fetchReturning())
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }))
    const xhr = FakeXhr.sent[0]!
    expect(xhr.url).toBe('/v1/imports')
    expect(xhr.headers['X-Requested-With']).toBe('fetch')
    expect(xhr.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(xhr.body?.get('market')).toBe('DE')
    expect(xhr.body?.get('period_to')).toBe('2025-03')
    expect((xhr.body?.get('orders') as File).type).toBe('text/csv')
    xhr.answer(201, { data: { id: 'b1', state: 'validated' }, meta: {} })
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith('/imports/b1'))
  })

  it('shows a refused market on its field and retries with the same key', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NewImportForm />, fetchReturning())
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }))
    FakeXhr.sent[0]!.answer(422, { error: { code: 'MARKET_UNKNOWN', message: 'No market with this code is available to you.', details: null, request_id: 'r' } })
    expect(await screen.findAllByText('No market with this code is available to you.')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }))
    expect(FakeXhr.sent[1]!.headers['Idempotency-Key']).toBe(FakeXhr.sent[0]!.headers['Idempotency-Key'])
    FakeXhr.sent[1]!.answer(429, { error: { code: 'IMPORT_BUSY', message: 'Another import is being validated or loaded.', details: null, request_id: 'r' } })
    expect(await screen.findByText('Another import is being validated or loaded.')).toBeTruthy()
    await user.type(screen.getByLabelText('Market'), 'X')
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }))
    expect(FakeXhr.sent[2]!.headers['Idempotency-Key']).not.toBe(FakeXhr.sent[0]!.headers['Idempotency-Key'])
  })
})
