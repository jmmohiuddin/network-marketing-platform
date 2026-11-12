// @vitest-environment jsdom
import '../test/dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import { ConfirmDialog, Modal } from './modal'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Approve support session" footer={<button type="button">Approve session</button>}>
        <input aria-label="Reason" data-autofocus />
      </Modal>
    </>
  )
}

describe('Modal', () => {
  it('is named by its title, focuses the marked field and traps Tab inside', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    expect(screen.getByRole('dialog', { name: 'Approve support session' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Reason'))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve session' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve session' }))
  })

  // BUG-044: a fixed modal dialog with height:auto fills top-to-bottom; fit-content hugs the content (sc_02-modal).
  it('fits its content from the sm breakpoint instead of stretching to its max height', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    const classes = screen.getByRole('dialog').className.split(' ')
    expect(classes).toContain('sm:h-fit')
    expect(classes).not.toContain('sm:h-auto')
  })

  it('closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open dialog' })
    await user.click(opener)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('ConfirmDialog', () => {
  it('uses a solid danger button only for the destructive confirmation', () => {
    render(<ConfirmDialog open title="Deactivate user" consequence="They can no longer sign in." confirmLabel="Deactivate user" destructive onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Deactivate user' }).className).toMatch(/\bbg-error\b.*\btext-on-error\b/)
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('bg-surface-container hover:bg-surface-container-high')
  })

  it('stays open with the error when the action fails', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(409, 'REQUEST_ALREADY_DECIDED', 'This request was already decided.'))
    render(<ConfirmDialog open title="End session" consequence="The vendor loses access now." confirmLabel="End session" onConfirm={onConfirm} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'End session' }))
    expect((await screen.findByRole('alert')).textContent).toContain('This request was already decided.')
    expect(screen.getByRole('dialog', { name: 'End session' })).toBeTruthy()
  })
})
