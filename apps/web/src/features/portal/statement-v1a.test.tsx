// @vitest-environment jsdom
import '../../test/dom'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../components/api-provider'
import { ToastProvider } from '../../components/toast'
import { ok } from '../../test/fetch'
import { rateDigits } from './format'
import { CATALOGUES } from './i18n'
import { PortalShell } from './shell'
import { StatementPage } from './statement'
import { LINE, page, portalMe, renderServer, RUN, serverRoutes, statement } from './test-support'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/portal/earnings',
  useSearchParams: () => new URLSearchParams(),
  redirect: (path: string) => { throw new Error(`redirect ${path}`) },
}))
vi.mock('next/headers', async () => ({ headers: async () => (await import('./test-support')).requestHeaders.current }))

const NBSP = ' '
// PLAN §6: BE-A's October final with an advance line, a credit award and a CHF order converted at 1.0412.
const V1A = statement({
  positions: [{
    ...statement().positions[0]!, total_minor: '-360',
    bonuses: [{ rule_key: 'weekly_advance', rule_name: null, total_minor: '-1000', lines: [{ id: LINE, amount_minor: '-1000', origin_kind: 'provisional', original_period_id: 'w1', original_period: { starts_on: '2026-10-05', ends_on: '2026-10-11' } }] }],
  }],
  credit_awards: [{ credit_type: { code: 'PRODUCT_CREDIT', name: 'Product credit' }, amount_minor: '900', currency: 'EUR', expires_on: '2026-12-21', taxable: false }],
  conversions: [{
    order_ref: 'O-BE-C-1', ordered_on: '2026-11-18', original_currency: 'CHF', original_amount_minor: '12000', rate: '1.0412000000',
    rate_valid_from: '2026-11-01T00:00:00.000Z', converted_amount_minor: '12494', currency: 'EUR',
  }],
})

describe('SC-18 statement additions (D-V1A-02/03/04)', () => {
  it('labels advance lines, lists non-cash rewards apart from the net amount and the currency conversions, in static HTML', async () => {
    const container = await renderServer(() => StatementPage({ runId: RUN }), serverRoutes({ [`GET /v1/me/statements/${RUN}`]: () => ok(V1A), 'GET /v1/me/disputes': () => page([]) }))
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('Advance paid for Oct 5, 2026 – Oct 11, 2026; deducted from the final amount')).toBeTruthy()
    const credits = screen.getByTestId('credit-awards')
    expect(within(credits).getByRole('heading', { name: 'Non-cash rewards (not paid in cash)' })).toBeTruthy()
    expect(within(credits).getByText('Product credit')).toBeTruthy()
    expect(within(credits).getByText('€9.00')).toBeTruthy()
    expect(within(credits).getByText('Expires on Dec 21, 2026')).toBeTruthy()
    const conversions = screen.getByTestId('conversions')
    const row = within(conversions).getByRole('row', { name: /O-BE-C-1/ })
    expect(within(row).getByText(`CHF${NBSP}120.00`)).toBeTruthy()
    expect(within(row).getByText('1.0412 from Nov 1, 2026')).toBeTruthy()
    expect(within(row).getByText('€124.94')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/wallet|Fast Start/i)
  })

  it('renders the German catalogue for the sections and leaves them out when empty', async () => {
    await renderServer(() => StatementPage({ runId: RUN }), serverRoutes({ [`GET /v1/me/statements/${RUN}`]: () => ok(V1A), 'GET /v1/me/disputes': () => page([]) }, portalMe({ locale: 'de' })))
    expect(screen.getByRole('heading', { name: 'Sachprämien (nicht in bar ausgezahlt)' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Währungsumrechnung' })).toBeTruthy()
    expect(screen.getByText(/^Vorschuss für .*; wird vom endgültigen Betrag abgezogen$/)).toBeTruthy()
    await renderServer(() => StatementPage({ runId: RUN }), serverRoutes({ [`GET /v1/me/statements/${RUN}`]: () => ok(statement()), 'GET /v1/me/disputes': () => page([]) }))
    expect(screen.queryByTestId('credit-awards')).toBeNull()
    expect(screen.queryByTestId('conversions')).toBeNull()
  })

  it('shows a non-cash award in its own currency, not the market currency', async () => {
    const chf = statement({ credit_awards: [{ ...V1A.credit_awards[0]!, currency: 'CHF' }] })
    await renderServer(() => StatementPage({ runId: RUN }), serverRoutes({ [`GET /v1/me/statements/${RUN}`]: () => ok(chf), 'GET /v1/me/disputes': () => page([]) }))
    expect(within(screen.getByTestId('credit-awards')).getByText(`CHF${NBSP}9.00`)).toBeTruthy()
  })

  it('trims a rate for display only', () => {
    expect(rateDigits('1.0412000000')).toBe('1.0412')
    expect(rateDigits('1.0000000000')).toBe('1')
    expect(rateDigits('0.9300000000')).toBe('0.93')
  })
})

describe('portal read-only notice (D-V1A-07)', () => {
  it('shows the notice in the effective language while the account is read-only, not otherwise', () => {
    const me = portalMe({ tenant: { slug: 'acme', legal_name: 'Acme Ltd', read_only: true }, locale: 'de' })
    const view = render(<ToastProvider><ApiProvider><PortalShell me={me} locale="de" catalogue={CATALOGUES.de} unread={0}><p>x</p></PortalShell></ApiProvider></ToastProvider>)
    expect(screen.getByTestId('read-only-notice').textContent).toContain('Dieses Konto ist archiviert: Sie können Daten lesen und exportieren, aber nicht ändern.')
    view.unmount()
    render(<ToastProvider><ApiProvider><PortalShell me={portalMe()} locale="en" catalogue={CATALOGUES.en} unread={0}><p>x</p></PortalShell></ApiProvider></ToastProvider>)
    expect(screen.queryByTestId('read-only-notice')).toBeNull()
  })
})
