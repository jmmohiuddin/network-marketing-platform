import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// AC-PAY2-3 / D-B4-14 (MONEY SAFETY): nothing under pay/** opens a network connection; the only adapters are the
// in-process sandbox and the bank-file generator.
const FORBIDDEN = [
  /from\s+['"](node:)?(http|https|net|tls|dgram|http2)['"]/, /import\(\s*['"](node:)?(http|https|net|tls|dgram|http2)['"]/,
  /require\(\s*['"](node:)?(http|https|net|tls|dgram|http2)['"]/, /['"]undici['"]/, /\bfetch\s*\(/,
]

function networkUses(source: string): string[] {
  return FORBIDDEN.filter((pattern) => pattern.test(source)).map(String)
}

describe('pay/** has no network access (T-B4-15)', () => {
  test('no source file imports a network module or calls fetch', () => {
    const dir = import.meta.dirname
    const offenders = readdirSync(dir).filter((name) => name.endsWith('.ts') && name !== 'network-guard.test.ts')
      .flatMap((name) => networkUses(readFileSync(join(dir, name), 'utf8')).map((use) => `${name}: ${use}`))
    expect(offenders).toEqual([])
  })

  test('the checker catches each form', () => {
    for (const source of ["import { request } from 'node:https'", "import http from 'http'", "await import('node:net')", "import { fetch } from 'undici'", 'await fetch(url)']) {
      expect(networkUses(source)).not.toEqual([])
    }
    expect(networkUses("import { createHmac } from 'node:crypto'")).toEqual([])
  })
})
