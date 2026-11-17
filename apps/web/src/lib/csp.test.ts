import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, firebaseAuthDomain } from './csp'

const directive = (policy: string, name: string) => policy.split('; ').find((part) => part.startsWith(`${name} `))

describe('contentSecurityPolicy', () => {
  it('allows only nonce-carrying scripts, no framing and same-origin API calls in production', () => {
    const policy = contentSecurityPolicy('abc123', false)

    expect(directive(policy, 'script-src')).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'")
    expect(directive(policy, 'style-src')).toBe("style-src 'self' 'nonce-abc123'")
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'")
    expect(policy).not.toContain('unsafe')
  })

  it('adds eval and inline styles for development tooling only', () => {
    const policy = contentSecurityPolicy('abc123', true)

    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'")
    expect(directive(policy, 'style-src')).toBe("style-src 'self' 'unsafe-inline'")
  })

  it('adds only the Firebase Auth sources when an auth domain is given', () => {
    const policy = contentSecurityPolicy('abc123', false, 'nmp.firebaseapp.com')

    expect(directive(policy, 'script-src')).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic' https://apis.google.com")
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com")
    expect(directive(policy, 'frame-src')).toBe("frame-src 'self' https://nmp.firebaseapp.com")
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(contentSecurityPolicy('abc123', false), 'frame-src')).toBeUndefined()
  })

  it('accepts only a host name as the Firebase auth domain', () => {
    expect(firebaseAuthDomain(' nmp.firebaseapp.com ')).toBe('nmp.firebaseapp.com')
    expect(firebaseAuthDomain('auth.example.com:8443')).toBe('auth.example.com:8443')
    expect(firebaseAuthDomain(undefined)).toBeNull()
    expect(firebaseAuthDomain('')).toBeNull()
    expect(firebaseAuthDomain("evil.com; script-src *")).toBeNull()
    expect(firebaseAuthDomain('https://nmp.firebaseapp.com')).toBeNull()
  })
})
