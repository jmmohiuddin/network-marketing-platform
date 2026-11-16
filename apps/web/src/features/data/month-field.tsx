'use client'

import { TextInput } from '../../components/form-field'
import { MONTH_PATTERN } from './period'

const MONTH_LENGTH = 7

export interface MonthFieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly error?: string | null
  readonly disabled?: boolean
  readonly onChange: (value: string) => void
}

/**
 * One month of a period range as the text "YYYY-MM" (BUG-026): the hint describes exactly what is typed, in every
 * browser (type="month" shows a picker or separate spin fields that do not match it). periodErrors validates it.
 */
export function MonthField({ id, label, value, error, disabled, onChange }: MonthFieldProps) {
  return (
    <TextInput
      id={id} label={label} type="text" inputMode="numeric" pattern={MONTH_PATTERN} maxLength={MONTH_LENGTH} autoComplete="off"
      placeholder="2025-01" helper="Year and month, for example 2025-01."
      value={value} error={error} disabled={disabled} onChange={(event) => onChange(event.target.value)}
    />
  )
}
