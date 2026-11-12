import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from './csp'

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
})
