// Client checks mirror the API's (auth-routes.ts, passwords.ts); the API still validates every request.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE = /^\d{6}$/
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 256
export const CODE_LENGTH = 6

export function requiredError(what: string, value: string): string | null {
  return value.trim() === '' ? `Enter ${what}.` : null
}

export function emailError(value: string): string | null {
  return requiredError('your email address', value) ?? (EMAIL.test(value.trim()) ? null : 'Enter an email address like name@example.com.')
}

export function codeError(value: string): string | null {
  if (value === '') return 'Enter the 6-digit code from your authenticator app.'
  return CODE.test(value) ? null : 'The code has 6 digits.'
}

export function passwordError(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  return value.length > PASSWORD_MAX_LENGTH ? `Use at most ${PASSWORD_MAX_LENGTH} characters.` : null
}

/** Keeps digits only, so a pasted "123 456" becomes "123456". */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, CODE_LENGTH)
}
