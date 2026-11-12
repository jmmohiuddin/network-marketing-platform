// @vitest-environment jsdom
import '../test/dom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KpiCard } from './kpi-card'
import { PageHeader } from './page-header'
import { QrCode, qrPath } from './qr-code'
import { SecretText } from './secret-text'
import { StatusBadge, toneOf } from './status-badge'
import { ErrorState, NotAvailable } from './states'
import { TabPanel, Tabs } from './tabs'
import { Stepper } from './stepper'

describe('StatusBadge', () => {
  it('maps states to families with an icon and a label', () => {
    expect([toneOf('loaded'), toneOf('approved'), toneOf('auto_denied'), toneOf('outdated'), toneOf('something_new')])
      .toEqual(['success', 'locked', 'danger', 'warning', 'neutral'])
    const { container } = render(<StatusBadge state="auto_denied" />)
    expect(screen.getByText('Auto denied').getAttribute('data-tone')).toBe('danger')
    expect(container.querySelector('.material-symbols-outlined[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('Tabs', () => {
  it('moves selection with arrow keys and keeps one tab stop', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Tabs label="User views" idPrefix="users" tabs={[{ id: 'users', label: 'Users' }, { id: 'roles', label: 'Roles' }]} selected="users" onSelect={onSelect} />)
    const [users, roles] = screen.getAllByRole('tab') as [HTMLElement, HTMLElement]
    expect(users.getAttribute('aria-selected')).toBe('true')
    expect(roles.tabIndex).toBe(-1)
    users.focus()
    await user.keyboard('{ArrowRight}')
    expect(onSelect).toHaveBeenCalledWith('roles')
    expect(document.activeElement).toBe(roles)
  })

  it('points only the selected tab at a panel, the one that is rendered', () => {
    render(
      <>
        <Tabs label="User views" idPrefix="users" tabs={[{ id: 'users', label: 'Users' }, { id: 'roles', label: 'Roles' }]} selected="users" onSelect={vi.fn()} />
        <TabPanel idPrefix="users" tabId="users">Users list</TabPanel>
      </>,
    )
    const [users, roles] = screen.getAllByRole('tab') as [HTMLElement, HTMLElement]
    expect(document.getElementById(users.getAttribute('aria-controls') ?? '')?.textContent).toBe('Users list')
    expect(roles.hasAttribute('aria-controls')).toBe(false)
  })
})

describe('ErrorState and NotAvailable inside a section', () => {
  it('use an h2 and a secondary action, leaving the page its h1 and primary action', () => {
    render(<><ErrorState message="Try later." onRetry={vi.fn()} section /><NotAvailable section /></>)
    expect(screen.getByRole('heading', { level: 2, name: 'This section could not be loaded' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Not found or not available to you' })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' }).className).toContain('bg-surface-container hover:bg-surface-container-high')
    expect(screen.getByRole('link', { name: 'Go to your home page' }).className).toContain('bg-surface-container hover:bg-surface-container-high')
  })
})

describe('QrCode', () => {
  it('draws the otpauth URI as a named SVG with a quiet zone', () => {
    const uri = 'otpauth://totp/NMP:a%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=NMP'
    const { modules, d } = qrPath(uri)
    expect(modules).toBeGreaterThan(21 + 8 - 1)
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true) // finder pattern corner, inside the quiet zone
    render(<QrCode value={uri} label="QR code for your authenticator app" />)
    expect(screen.getByRole('img', { name: 'QR code for your authenticator app' }).getAttribute('viewBox')).toBe(`0 0 ${modules} ${modules}`)
  })
})

describe('SecretText', () => {
  it('shows the key in groups and copies it without spaces', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<SecretText label="Setup key" value="JBSWY3DPEHPK3PXP" />)
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Copy key' }))
    expect(writeText).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP')
    expect(screen.getByRole('status').textContent).toBe('Key copied.')
  })
})

describe('PageHeader and Breadcrumbs', () => {
  it('render one h1 and a breadcrumb trail whose last item is the current page', () => {
    render(<PageHeader title="Batch 12" eyebrow="2025-01" breadcrumbs={[{ label: 'Data imports', href: '/imports' }, { label: 'Batch 12' }]} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByRole('link', { name: 'Data imports' }).getAttribute('href')).toBe('/imports')
    expect(within(trail).getByText('Batch 12').getAttribute('aria-current')).toBe('page')
  })
})

describe('KpiCard and Stepper', () => {
  it('show a missing value as a dash with its reason', () => {
    render(<KpiCard label="Customer share" value={null} unit="%" detail="No snapshot for this market yet." />)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.queryByText('%')).toBeNull()
    expect(screen.getByText('No snapshot for this market yet.')).toBeTruthy()
  })

  it('state each step in text and mark the current one', () => {
    render(<Stepper label="Go-live" steps={[{ label: 'Provisioned', status: 'done' }, { label: 'Approved', status: 'current' }, { label: 'Live', status: 'blocked', detail: 'Needs a second admin.' }]} />)
    const steps = within(screen.getByRole('list', { name: 'Go-live' })).getAllByRole('listitem')
    expect(steps[1]?.getAttribute('aria-current')).toBe('step')
    expect(steps[2]?.textContent).toContain('Step 3 · blocked')
    expect(steps[2]?.textContent).toContain('Needs a second admin.')
  })
})
