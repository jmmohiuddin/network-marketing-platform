import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { errorMessage, fieldErrors, isNotAvailable } from './messages'
import { activeEntry, afterSignInPath, authRedirectPath, safeNext, withNext } from './navigation'
import { homePath, pendingMfaPath, shellRedirect, type Me } from './me'
import { codeError, digitsOnly, emailError, passwordError } from './validation'

describe('safeNext', () => {
  it('keeps same-origin paths with their query', () => {
    expect(safeNext('/settings/users?tab=roles')).toBe('/settings/users?tab=roles')
  })

  it.each([null, '', 'https://evil.example/', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', '/signin', '/signin/mfa?next=/x', '/invitation'])(
    'refuses %s',
    (value) => expect(safeNext(value)).toBeNull(),
  )
})

describe('redirect paths', () => {
  it('carries the target of an auth page instead of the auth page itself', () => {
    expect(authRedirectPath('UNAUTHENTICATED', '/signin/mfa?next=%2Fimports')).toBe('/signin?next=%2Fimports')
    expect(authRedirectPath('UNAUTHENTICATED', '/signin/mfa?next=%2Fvendor')).toBe('/signin/vendor?next=%2Fvendor')
    expect(authRedirectPath('UNAUTHENTICATED', '/')).toBe('/signin')
    expect(authRedirectPath('PERMISSION_DENIED', '/imports')).toBeNull()
  })

  it('routes a sign-in to the step the server asks for', () => {
    expect(afterSignInPath('none', '/imports')).toBe('/imports')
    expect(afterSignInPath('mfa_enrolment', '/')).toBe('/signin/enrol')
    expect(afterSignInPath('mfa_verification', '/vendor')).toBe('/signin/mfa?next=%2Fvendor')
    expect(withNext('/signin', null)).toBe('/signin')
  })

  it('marks the most specific navigation entry as current', () => {
    const entries = [
      { key: 'settings', path: '/settings', label: 'Settings' },
      { key: 'users', path: '/settings/users', label: 'Users and roles' },
    ]
    expect(activeEntry('/settings/users/42', entries)?.key).toBe('users')
    expect(activeEntry('/settings', entries)?.key).toBe('settings')
    expect(activeEntry('/settingsx', entries)).toBeUndefined()
  })
})

describe('session routing', () => {
  const me = (overrides: Partial<Me>): Me => ({
    user: { id: 'u', email: 'a@example.com', display_name: null },
    tenant: null,
    realm: 'tenant',
    roles: [],
    permissions: [],
    mfa: { required: false, enrolled: false, verified: false },
    step_up_at: null,
    navigation: [{ key: 'imports', path: '/imports', label: 'Data imports' }],
    ...overrides,
  })

  it('puts pending MFA before any page (AC-35.1)', () => {
    expect(pendingMfaPath(me({ mfa: { required: true, enrolled: false, verified: false } }))).toBe('/signin/enrol')
    expect(pendingMfaPath(me({ mfa: { required: false, enrolled: true, verified: false } }))).toBe('/signin/mfa')
    expect(homePath(me({ mfa: { required: true, enrolled: false, verified: false }, navigation: [] }))).toBe('/signin/enrol')
  })

  it('keeps a vendor user with pending MFA in the vendor realm', () => {
    expect(homePath(me({ realm: 'vendor', mfa: { required: true, enrolled: true, verified: false }, navigation: [] }))).toBe('/signin/mfa?next=%2Fvendor')
  })

  it('sends users home to their first navigation entry, or nowhere when they have none', () => {
    expect(homePath(me({}))).toBe('/imports')
    expect(homePath(me({ navigation: [] }))).toBeNull()
  })

  it('sends users of the other realm out of a shell', () => {
    expect(shellRedirect(me({ realm: 'vendor' }), 'tenant')).toBe('/')
    expect(shellRedirect(me({}), 'tenant')).toBeNull()
  })
})

describe('messages', () => {
  it('maps client codes and hides server failures behind a reference', () => {
    expect(errorMessage(new ApiError(0, 'NETWORK_ERROR', 'x'))).toBe('Cannot reach the service. Check your connection and try again.')
    expect(errorMessage(new ApiError(500, 'INTERNAL_ERROR', 'stack', null, 'abc'))).toBe('Something went wrong. Try again later. Reference: abc')
    expect(errorMessage(new ApiError(409, 'SLUG_TAKEN', 'Another tenant already uses this slug.'))).toBe('Another tenant already uses this slug.')
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Try again later.')
  })

  it('reads VALIDATION_FAILED issues by path and ignores malformed details', () => {
    const issues = { issues: [{ path: 'password', message: 'must be at least 12 characters' }, { path: 3 }] }
    expect(fieldErrors(new ApiError(400, 'VALIDATION_FAILED', 'x', issues))).toEqual({ password: 'must be at least 12 characters' })
    expect(fieldErrors(new ApiError(400, 'VALIDATION_FAILED', 'x', 'nope'))).toEqual({})
  })

  it('treats 404, PERMISSION_DENIED and REALM_FORBIDDEN alike', () => {
    expect(isNotAvailable(new ApiError(404, 'NOT_FOUND', 'x'))).toBe(true)
    expect(isNotAvailable(new ApiError(403, 'PERMISSION_DENIED', 'x'))).toBe(true)
    expect(isNotAvailable(new ApiError(403, 'STEP_UP_REQUIRED', 'x'))).toBe(false)
  })
})

describe('validation', () => {
  it('checks codes, emails and passwords like the API', () => {
    expect(digitsOnly('12 34-56 7')).toBe('123456')
    expect(codeError('12345')).toBe('The code has 6 digits.')
    expect(codeError('123456')).toBeNull()
    expect(emailError('a@b')).not.toBeNull()
    expect(emailError(' a@example.com ')).toBeNull()
    expect(passwordError('x'.repeat(11))).toBe('Use at least 12 characters.')
    expect(passwordError('x'.repeat(12))).toBeNull()
  })
})
