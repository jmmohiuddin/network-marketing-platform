// Client checks of the sign-in fields in catalogue words (lib/validation's rules; the API still validates every request).
import { emailError } from '../../lib/validation'
import type { Translate } from '../portal/i18n'

export function emailProblem(value: string, t: Translate): string | null {
  if (value.trim() === '') return t('auth.email_required')
  return emailError(value) === null ? null : t('auth.email_invalid')
}

export function passwordProblem(value: string, t: Translate): string | null {
  return value.trim() === '' ? t('auth.password_required') : null
}
