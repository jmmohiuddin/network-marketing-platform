'use client'

import { useId, type ChangeEvent, type ComponentProps, type ReactNode } from 'react'
import { Icon } from './icon'

/** sc_01 header search input (bordered), with a visible focus ring and the error state. */
export const INPUT_CLASS = 'w-full h-8 px-3 rounded bg-surface border border-outline-variant font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary aria-[invalid=true]:border-error aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-error read-only:bg-surface-container-low disabled:opacity-60 transition-colors'
/** The same field look for a multi-line textarea (sc_39 l.~530). */
export const TEXTAREA_CLASS = 'w-full px-3 py-2 rounded bg-surface border border-outline-variant font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary aria-[invalid=true]:border-error aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-error disabled:opacity-60 transition-colors'
/** sc_39 form label. */
export const LABEL_CLASS = 'font-caption text-caption uppercase tracking-wider text-secondary font-medium'
const SELECT_CLASS = 'w-full h-9 px-space-sm rounded bg-surface-bright border border-outline-variant font-body-sm text-body-sm text-on-surface cursor-pointer focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary aria-[invalid=true]:border-error aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-error disabled:opacity-60'
const HELPER_CLASS = 'font-caption text-caption text-secondary'
const CHOICE_CLASS = 'mt-0.5 h-4 w-4 shrink-0 accent-primary cursor-pointer disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

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

/** A field's error line: icon + text in the error colour. */
export function FieldError({ id, message }: { readonly id?: string; readonly message: string }) {
  return (
    <p className="flex items-start gap-1 font-caption text-caption text-error">
      <Icon name="error" size={14} className="mt-px" />
      <span id={id}>{message}</span>
    </p>
  )
}

/** Label above, control, helper or error below. Use it for any custom control (render prop). */
export function FormField({ label, helper, error, optional = false, id, children }: FormFieldProps) {
  const generated = useId()
  const controlId = id ?? generated
  const helperId = `${controlId}-helper`
  const errorId = `${controlId}-error`
  const hasError = error !== undefined && error !== null
  const describedBy = hasError ? errorId : helper === undefined ? undefined : helperId
  return (
    <div className="flex flex-col gap-space-xs">
      <label className={LABEL_CLASS} htmlFor={controlId}>
        {label}
        {optional && <span className="normal-case tracking-normal"> (optional)</span>}
      </label>
      {children({ id: controlId, 'aria-describedby': describedBy, 'aria-invalid': hasError ? true : undefined })}
      {hasError ? <FieldError id={errorId} message={error} /> : helper !== undefined && <p id={helperId} className={HELPER_CLASS}>{helper}</p>}
    </div>
  )
}

export type TextInputProps = FieldLabelProps & Omit<ComponentProps<'input'>, 'id'> & {
  /** Leading icon inside the field (search, filter_list). */
  readonly icon?: string
  /** Unit after the value (money: "EUR"). */
  readonly suffix?: string
}

/** Text, email, password, number or search input with label, helper and error (sc_01 l.~238). */
export function TextInput({ label, helper, error, optional, id, className, icon, suffix, ...input }: TextInputProps) {
  return (
    <FormField label={label} helper={helper} error={error} optional={optional} id={id}>
      {(control) => (
        <div className="relative flex items-center w-full">
          {icon !== undefined && <Icon name={icon} size={16} className="absolute left-2.5 text-outline" />}
          <input {...input} {...control} className={[INPUT_CLASS, icon === undefined ? '' : 'pl-8', suffix === undefined ? '' : 'pr-12', className].filter(Boolean).join(' ')} />
          {suffix !== undefined && <span className="absolute right-3 font-data-mono-sm text-data-mono-sm text-secondary">{suffix}</span>}
        </div>
      )}
    </FormField>
  )
}

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export type SelectProps = FieldLabelProps & Omit<ComponentProps<'select'>, 'id'> & {
  readonly options: readonly SelectOption[]
  /** Shown while nothing is chosen; it is not a choice itself. */
  readonly placeholder?: string
}

/** Native select (sc_39 l.~507): native on phones; switch to a combobox above ~12 options. */
export function Select({ label, helper, error, optional, id, options, placeholder, className, ...select }: SelectProps) {
  return (
    <FormField label={label} helper={helper} error={error} optional={optional} id={id}>
      {(control) => (
        <select {...select} {...control} className={[SELECT_CLASS, className].filter(Boolean).join(' ')}>
          {placeholder !== undefined && <option value="" disabled>{placeholder}</option>}
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </FormField>
  )
}

export type CheckboxProps = Omit<FieldLabelProps, 'optional'> & Omit<ComponentProps<'input'>, 'id' | 'type' | 'ref'>

/** Checkbox with its label on the right (sc_02-modal acknowledgement item); the label is clickable. */
export function Checkbox({ label, helper, error, id, className, ...input }: CheckboxProps) {
  const generated = useId()
  const controlId = id ?? generated
  const noteId = `${controlId}-note`
  const hasError = error !== undefined && error !== null
  return (
    <div className={['flex items-start gap-space-sm', className].filter(Boolean).join(' ')}>
      <input
        {...input}
        id={controlId}
        type="checkbox"
        className={CHOICE_CLASS}
        aria-describedby={hasError || helper !== undefined ? noteId : undefined}
        aria-invalid={hasError ? true : undefined}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={controlId} className="font-body-sm text-body-sm text-on-surface cursor-pointer">{label}</label>
        {hasError ? <FieldError id={noteId} message={error} /> : helper !== undefined && <p id={noteId} className={HELPER_CLASS}>{helper}</p>}
      </div>
    </div>
  )
}

export interface RadioGroupProps {
  /** The question the choices answer (the fieldset legend). */
  readonly legend: string
  readonly name: string
  readonly options: readonly (SelectOption & { readonly helper?: string })[]
  readonly value: string
  readonly onChange: (value: string) => void
  readonly error?: string | null
  readonly disabled?: boolean
}

/** Radio group as fieldset + legend (sc_33 ERP choice). */
export function RadioGroup({ legend, name, options, value, onChange, error, disabled }: RadioGroupProps) {
  const errorId = `${useId()}-error`
  const hasError = error !== undefined && error !== null
  return (
    <fieldset className="flex flex-col gap-space-xs" aria-describedby={hasError ? errorId : undefined}>
      <legend className={`${LABEL_CLASS} mb-space-xs`}>{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-start gap-space-sm p-space-sm rounded bg-surface-container-low hover:bg-surface-container cursor-pointer transition-colors">
          <input
            type="radio"
            className={CHOICE_CLASS}
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          />
          <span className="flex flex-col">
            <span className="font-body-sm text-body-sm text-on-surface font-medium">{option.label}</span>
            {option.helper !== undefined && <span className={HELPER_CLASS}>{option.helper}</span>}
          </span>
        </label>
      ))}
      {hasError && <FieldError id={errorId} message={error} />}
    </fieldset>
  )
}
