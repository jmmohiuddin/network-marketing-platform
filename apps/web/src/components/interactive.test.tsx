// @vitest-environment jsdom
import '../test/dom'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { apiError, fetchReturning } from '../test/fetch'
import { renderWithProviders } from '../test/render'
import { Drawer } from './drawer'
import { FileDropZone, formatMegabytes } from './file-drop-zone'
import { FilterChips } from './filters-bar'
import { Popover } from './popover'
import { SegmentedControl } from './segmented-control'
import { StepUpModal } from './step-up-modal'
import { Switch } from './switch'
import { TabPanel, Tabs } from './tabs'

describe('Tabs keyboard', () => {
  it('wraps with the arrow keys and jumps with Home and End', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [selected, setSelected] = useState('users')
      return (
        <>
          <Tabs label="User views" idPrefix="u" selected={selected} onSelect={setSelected}
            tabs={[{ id: 'users', label: 'Users' }, { id: 'roles', label: 'Roles' }, { id: 'approvals', label: 'Approvals', count: 3 }]} />
          <TabPanel idPrefix="u" tabId={selected}>{selected} panel</TabPanel>
        </>
      )
    }
    render(<Harness />)
    screen.getByRole('tab', { name: 'Users' }).focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Approvals 3' }).getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Users' }))
    await user.keyboard('{End}')
    expect(screen.getByRole('tabpanel').textContent).toBe('approvals panel')
  })
})

describe('SegmentedControl', () => {
  it('is a radio group with one tab stop that arrow keys move and select', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SegmentedControl label="Tree kind" value="sponsor" onChange={onChange} options={[{ value: 'sponsor', label: 'Sponsor tree' }, { value: 'placement', label: 'Placement tree' }]} />)
    const group = screen.getByRole('radiogroup', { name: 'Tree kind' })
    const [sponsor, placement] = screen.getAllByRole('radio') as [HTMLElement, HTMLElement]
    expect(group).toBeTruthy()
    expect(sponsor.getAttribute('aria-checked')).toBe('true')
    expect(placement.tabIndex).toBe(-1)
    sponsor.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith('placement')
    expect(document.activeElement).toBe(placement)
  })
})

describe('Switch', () => {
  it('is a labelled switch with On/Off text, and a locked one says why and cannot change', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<Switch label="Email" description="Monthly statement" checked={false} onChange={onChange} />)
    await user.click(screen.getByRole('switch', { name: 'Email' }))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(screen.getByText('Off')).toBeTruthy()
    rerender(<Switch label="Email" checked onChange={onChange} locked="Required by law in this market." />)
    const locked = screen.getByRole('switch', { name: 'Email' }) as HTMLInputElement
    expect(locked.disabled).toBe(true)
    expect(document.getElementById(locked.getAttribute('aria-describedby')!)?.textContent).toBe('Required by law in this market.')
  })
})

describe('Drawer', () => {
  it('is a named modal dialog that traps focus, closes on Escape and returns focus', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open details</button>
          <Drawer open={open} onClose={() => setOpen(false)} title="Event details"><button type="button" data-autofocus>Copy id</button></Drawer>
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open details' })
    await user.click(opener)
    expect(screen.getByRole('dialog', { name: 'Event details' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy id' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close panel' }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy id' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('FilterChips', () => {
  it('names each remove button after its filter and clears all', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const onClear = vi.fn()
    render(<FilterChips chips={[{ key: 'actor', label: 'Actor: Ada Admin', onRemove }]} onClear={onClear} />)
    await user.click(screen.getByRole('button', { name: 'Remove filter: Actor: Ada Admin' }))
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }))
    expect(onRemove).toHaveBeenCalled()
    expect(onClear).toHaveBeenCalled()
  })
})

describe('FileDropZone', () => {
  it('formats sizes in MB, and in KB below 0.1 MB so a small file never reads 0 MB (BUG-078)', () => {
    expect(formatMegabytes(40_000)).toBe('40 KB')
    expect(formatMegabytes(1)).toBe('1 KB')
    expect(formatMegabytes(1024 * 1024)).toBe('1 MB')
    expect(formatMegabytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })

  it('takes a dropped file through the same type check as the picker', () => {
    const onFiles = vi.fn()
    render(<FileDropZone label="Orders file" extensions={['.csv']} onFiles={onFiles} />)
    const zone = screen.getByText('Drag and drop a file here, or choose one').parentElement!
    const good = new File(['a'], 'orders.csv')
    fireEvent.drop(zone, { dataTransfer: { files: [good] } })
    expect(onFiles).toHaveBeenLastCalledWith([good])
    expect(screen.getByText('orders.csv')).toBeTruthy()
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['a'], 'orders.xlsx')] } })
    expect(screen.getByText('orders.xlsx is not a .csv file.')).toBeTruthy()
    expect(onFiles).toHaveBeenLastCalledWith([])
  })
})

describe('StepUpModal', () => {
  it('keeps the dialog open with the server message when the code cannot be checked (locked out)', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    renderWithProviders(<StepUpModal open onDone={onDone} />, fetchReturning(apiError(429, 'RATE_LIMITED', 'Too many attempts. Try again in 15 minutes.')))
    expect(screen.getByRole('dialog', { name: 'Confirm with your authenticator app' })).toBeTruthy()
    const code = screen.getByLabelText('Verification code')
    expect(document.activeElement).toBe(code)
    expect(code.getAttribute('autocomplete')).toBe('one-time-code')
    await user.type(code, '12ab3456')
    expect((code as HTMLInputElement).value).toBe('123456')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Too many attempts. Try again in 15 minutes.')
    expect(onDone).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDone).toHaveBeenCalledWith(false)
  })
})

describe('Popover', () => {
  it('opens on click and keyboard focus, describes its button, closes on Escape with focus back and on an outside pointer', async () => {
    const user = userEvent.setup()
    render(<><Popover label="Definition of Net sales" text="Definition"><p>Orders credited in the period minus refunds.</p></Popover><p>Outside</p></>)
    const button = screen.getByRole('button', { name: 'Definition of Net sales' })
    const note = document.getElementById(button.getAttribute('aria-controls')!)!
    expect(button.getAttribute('aria-describedby')).toBe(note.id)
    expect(note.hidden).toBe(true)
    await user.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('note').textContent).toBe('Orders credited in the period minus refunds.')
    await user.keyboard('{Escape}')
    expect(note.hidden).toBe(true)
    expect(document.activeElement).toBe(button)
    button.blur()
    await user.tab()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Enter}') // BUG-123: activating the focused button keeps it open
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Enter}')
    expect(note.hidden).toBe(true)
    await user.keyboard(' ')
    expect(note.hidden).toBe(false)
    button.blur()
    await user.tab()
    await user.keyboard('{Escape}{Enter}') // after Escape, Enter opens it again
    expect(note.hidden).toBe(false)
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByText('Outside') })
    expect(note.hidden).toBe(true)
  })
})
