import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { decodeRefs } from './audit.js'
import { marketScope, type AuthContext, type RoleGrant } from './auth.js'
import { csvCell, toCsv } from './csv.js'
import { decodeCursor, encodeCursor, toPage } from './pagination.js'

const ENV = {
  NODE_ENV: 'test', DATABASE_URL: 'postgres://nmp_app@localhost/nmp_test', SECRET_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
}

describe('config', () => {
  test('applies the E-ADR-10 defaults; cookies are Secure unless COOKIE_SECURE=false', () => {
    const config = loadConfig(ENV)

    expect(config).toMatchObject({
      port: 4000, sessionAbsoluteMinutes: 720, sessionIdleMinutes: 30, stepUpMaxAgeSeconds: 600, lockoutMaxFailures: 5,
      lockoutWindowMinutes: 15, exportRowCap: 50_000, cookieSecure: true, webUrl: 'http://127.0.0.1:3100',
    })
    expect(loadConfig({ ...ENV, NODE_ENV: 'development', COOKIE_SECURE: 'false' }).cookieSecure).toBe(false)
    expect(loadConfig({ ...ENV, WEB_URL: 'https://app.example/' }).webUrl).toBe('https://app.example')
  })

  test('fails closed: NODE_ENV has no default, COOKIE_SECURE takes only boolean words, a session lasts at most 12 h', () => {
    const { NODE_ENV: _omitted, ...withoutEnv } = ENV

    expect(() => loadConfig(withoutEnv)).toThrow(/^NODE_ENV: /m)
    expect(() => loadConfig({ ...ENV, COOKIE_SECURE: 'maybe' })).toThrow(/^COOKIE_SECURE: /m)
    expect(() => loadConfig({ ...ENV, WEB_URL: 'javascript:alert(1)' })).toThrow(/^WEB_URL: /m)
    expect(() => loadConfig({ ...ENV, SESSION_ABSOLUTE_MINUTES: '721' })).toThrow(/^SESSION_ABSOLUTE_MINUTES: /m)
  })

  test('fails fast with every problem: missing database URL, short key, bad port', () => {
    const problems = (() => {
      try {
        loadConfig({ SECRET_ENCRYPTION_KEY: 'change-me', API_PORT: '0' })
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })()

    expect(problems).toMatch(/^DATABASE_URL: /m)
    expect(problems).toMatch(/^API_PORT: /m)
    expect(problems).toMatch(/^SECRET_ENCRYPTION_KEY: must be 32 random bytes/m)
  })
})

describe('CSV', () => {
  test('quotes separators and neutralises formulas, but keeps plain negative numbers numeric (T14)', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('-1+1')).toBe("'-1+1")
    expect(csvCell('-2+3+cmd|\' /C calc\'!A0')).toBe("'-2+3+cmd|' /C calc'!A0")
    expect(csvCell('-240')).toBe('-240')
    expect(csvCell(-14.3)).toBe('-14.3')
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell(null)).toBe('')
    expect(csvCell({ n: 1 })).toBe('"{""n"":1}"')
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('a,b\r\n1,x\r\n')
  })
})

describe('cursor pagination', () => {
  test('a page of limit rows carries the cursor of its last row; the last page carries null', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]

    const page = toPage(rows, 2, (row) => row.id)
    const last = toPage(rows.slice(2), 2, (row) => row.id)

    expect(page.data).toEqual([{ id: 1 }, { id: 2 }])
    expect(decodeCursor(page.meta.next_cursor as string, z.number())).toBe(2)
    expect(last.meta.next_cursor).toBeNull()
  })

  test('a cursor that was not issued, or has the wrong shape, is 400 INVALID_CURSOR', () => {
    expect(() => decodeCursor('%%%', z.number())).toThrow('cursor is not valid')
    expect(() => decodeCursor(encodeCursor('text'), z.number())).toThrow('cursor is not valid')
    expect(decodeCursor(undefined, z.number())).toBeUndefined()
  })
})

describe('audit references', () => {
  test('decodes the recordAudit envelope and passes other values through', () => {
    expect(decodeRefs('{"v":1}', '{"after":{"v":2},"reason":"why"}')).toEqual({ before: { v: 1 }, after: { v: 2 }, reason: 'why' })
    expect(decodeRefs(null, 'not json')).toEqual({ before: null, after: 'not json', reason: null })
  })
})

describe('market scope (SEC-26 a, AC-36.2)', () => {
  const grant = (permissions: RoleGrant['permissions'], marketIds: string[] | null): RoleGrant => ({
    assignmentId: 'a', roleId: 'r', name: 'n', permissions, marketIds, validTo: null,
  })
  const auth = (roles: RoleGrant[]) => ({ roles }) as unknown as AuthContext

  test('unscoped grants see every market; scoped grants only their markets; others none', () => {
    expect(marketScope(auth([grant(['compliance.read'], null), grant(['compliance.read'], ['m1'])]), 'compliance.read')).toBeNull()
    expect(marketScope(auth([grant(['compliance.read'], ['m1']), grant(['compliance.read'], ['m2', 'm1'])]), 'compliance.read')).toEqual(['m1', 'm2'])
    expect(marketScope(auth([grant(['audit.read'], null)]), 'compliance.read')).toEqual([])
  })
})
