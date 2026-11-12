// @vitest-environment jsdom
import '../test/dom'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorSummary } from './error-summary'
import { FileDropZone } from './file-drop-zone'
import { Select, TextInput } from './form-field'

describe('TextInput', () => {
  it('labels the input and describes it with the helper', () => {
    render(<TextInput label="Email address" helper="Your work address." />)
    const input = screen.getByLabelText('Email address')
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Your work address.')
  })

  it('replaces the helper with the error and marks the input invalid', () => {
    render(<TextInput label="Email address" helper="Your work address." error="Enter an email address like name@example.com." />)
    const input = screen.getByLabelText('Email address')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Enter an email address like name@example.com.')
    expect(screen.queryByText('Your work address.')).toBeNull()
  })

  it('says "(optional)" for optional fields only', () => {
    render(<TextInput label="Display name" optional />)
    expect(screen.getByLabelText('Display name (optional)')).toBeTruthy()
  })
})

describe('Select', () => {
  it('shows the placeholder as a disabled option', () => {
    render(<Select label="Market" placeholder="Choose a market" defaultValue="" options={[{ value: 'eu', label: 'Europe' }]} />)
    const placeholder = screen.getByRole('option', { name: 'Choose a market' }) as HTMLOptionElement
    expect(placeholder.disabled).toBe(true)
  })
})

describe('ErrorSummary', () => {
  it('takes focus and links each error to its field', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ErrorSummary items={[{ fieldId: 'email', message: 'Enter your email address.' }, { message: 'The email or password is not correct.' }]} />
        <input id="email" aria-label="Email" />
      </>,
    )
    expect(document.activeElement).toBe(screen.getByRole('alert'))
    await user.click(screen.getByRole('link', { name: 'Enter your email address.' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Email'))
  })
})

describe('FileDropZone', () => {
  const choose = (files: File[]) => fireEvent.change(screen.getByLabelText('Orders file'), { target: { files } })

  it('states accepted types and refuses other files; size is left to the server', () => {
    const onFiles = vi.fn()
    render(<FileDropZone label="Orders file" extensions={['.csv']} onFiles={onFiles} />)
    expect(screen.getByText('.csv file.')).toBeTruthy()
    choose([new File(['a'], 'orders.xlsx')])
    expect(screen.getByText('orders.xlsx is not a .csv file.')).toBeTruthy()
    expect(onFiles).toHaveBeenLastCalledWith([])
    const good = new File(['a'.repeat(64 * 1024)], 'orders.csv')
    choose([good])
    expect(onFiles).toHaveBeenLastCalledWith([good])
  })
})
