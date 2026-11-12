'use client'

import { AlertTriangle } from 'lucide-react'
import { useId, type ComponentProps, type ReactNode } from 'react'

export interface FieldLabelProps {
  readonly label: string
  /** Below the control; the error replaces it while shown. */
  readonly helper?: ReactNode
  /** What is wrong and how to fix it. */
  readonly error?: string | null
  /** Required fields are unmarked; optional ones say "(optional)". */
  readonly optional?: boolean
  /** Stable id for links from an ErrorSummary; generated when absent. */
  readonly id?: string
}

/** Props FormField hands to its control: the label target and the error/helper association. */
export interface ControlProps {
  readonly id: string
  readonly 'aria-describedby': string | undefined
  readonly 'aria-invalid': true | undefined
}

export interface FormFieldProps extends FieldLabelProps {
  readonly children: (control: ControlProps) => ReactNode
}

export function FieldError({ id, message }: { readonly id?: string; readonly message: string }) {
  return (
    <p id={id} className="field-error">
      <AlertTriangle size={16} aria-hidden="true" />
      {message}
    </p>
  )
}

/** Label above, control, helper or error below (UX-05 §6.1). Use it for any custom control. */
export function FormField({ label, helper, error, optional = false, id, children }: FormFieldProps) {
  const generated = useId()
  const controlId = id ?? generated
  const helperId = `${controlId}-helper`
  const errorId = `${controlId}-error`
  const hasError = error !== undefined && error !== null
  const describedBy = hasError ? errorId : helper === undefined ? undefined : helperId
  return (
    <div className="field">
      <label className="field-label" htmlFor={controlId}>
        {label}
        {optional && <span className="field-optional"> (optional)</span>}
      </label>
      {children({ id: controlId, 'aria-describedby': describedBy, 'aria-invalid': hasError ? true : undefined })}
      {hasError ? <FieldError id={errorId} message={error} /> : helper !== undefined && <p id={helperId} className="field-helper">{helper}</p>}
    </div>
  )
}

export type TextFieldProps = FieldLabelProps & Omit<ComponentProps<'input'>, 'id'>

/** Text, email, password or number input with label, helper and error. */
export function TextField({ label, helper, error, optional, id, className, ...input }: TextFieldProps) {
  return (
    <FormField label={label} helper={helper} error={error} optional={optional} id={id}>
      {(control) => <input {...input} {...control} className={['input', className].filter(Boolean).join(' ')} />}
    </FormField>
  )
}

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export type SelectFieldProps = FieldLabelProps & Omit<ComponentProps<'select'>, 'id'> & {
  readonly options: readonly SelectOption[]
  /** Shown while nothing is chosen; it is not a choice itself. */
  readonly placeholder?: string
}

/** Native select (UI-04: native on phones; switch to a combobox above ~12 options). */
export function SelectField({ label, helper, error, optional, id, options, placeholder, className, ...select }: SelectFieldProps) {
  return (
    <FormField label={label} helper={helper} error={error} optional={optional} id={id}>
      {(control) => (
        <select {...select} {...control} className={['input', 'select', className].filter(Boolean).join(' ')}>
          {placeholder !== undefined && <option value="" disabled>{placeholder}</option>}
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </FormField>
  )
}

export type CheckboxProps = Omit<FieldLabelProps, 'optional'> & Omit<ComponentProps<'input'>, 'id' | 'type' | 'ref'>

/** Checkbox with its label on the right; the label is clickable. */
export function Checkbox({ label, helper, error, id, className, ...input }: CheckboxProps) {
  const generated = useId()
  const controlId = id ?? generated
  const noteId = `${controlId}-note`
  const hasError = error !== undefined && error !== null
  return (
    <div className={['checkbox', className].filter(Boolean).join(' ')}>
      <input
        {...input}
        id={controlId}
        type="checkbox"
        aria-describedby={hasError || helper !== undefined ? noteId : undefined}
        aria-invalid={hasError ? true : undefined}
      />
      <label htmlFor={controlId}>{label}</label>
      {hasError ? <FieldError id={noteId} message={error} /> : helper !== undefined && <p id={noteId} className="field-helper">{helper}</p>}
    </div>
  )
}
