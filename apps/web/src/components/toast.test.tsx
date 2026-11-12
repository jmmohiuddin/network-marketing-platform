// @vitest-environment jsdom
import '../test/dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { TOAST_DURATION_MS, ToastProvider, useToast } from './toast'

function Trigger({ message }: { readonly message: string }) {
  const show = useToast()
  return <button type="button" onClick={() => show({ message })}>{`Show ${message}`}</button>
}

function renderToasts(...messages: string[]) {
  render(<ToastProvider>{messages.map((message) => <Trigger key={message} message={message} />)}</ToastProvider>)
}

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('announces in a polite region and disappears after 5 seconds', () => {
    renderToasts('Invitation sent.')
    fireEvent.click(screen.getByRole('button', { name: 'Show Invitation sent.' }))
    expect(screen.getByRole('status').textContent).toContain('Invitation sent.')
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS))
    expect(screen.getByRole('status').textContent).not.toContain('Invitation sent.')
  })

  it('waits while hovered', () => {
    renderToasts('Saved.')
    fireEvent.click(screen.getByRole('button', { name: 'Show Saved.' }))
    fireEvent.mouseEnter(screen.getByText('Saved.'))
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 2))
    expect(screen.getByText('Saved.')).toBeTruthy()
    fireEvent.mouseLeave(screen.getByText('Saved.'))
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS))
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('keeps at most three', () => {
    renderToasts('One.', 'Two.', 'Three.', 'Four.')
    for (const message of ['One.', 'Two.', 'Three.', 'Four.']) fireEvent.click(screen.getByRole('button', { name: `Show ${message}` }))
    expect(screen.queryByText('One.')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(3)
  })
})
