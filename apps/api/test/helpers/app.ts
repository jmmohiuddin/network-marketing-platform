import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closePool } from '@nmp/db'
import { closeOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { afterAll } from 'vitest'
import { buildApp } from '../../src/app.js'
import { loadConfig, type Config } from '../../src/config.js'
import type { ApiModule } from '../../src/lib/module.js'

/** Fixed test key (32 bytes, base64). Never used outside tests. */
export const TEST_SECRET_KEY = Buffer.alloc(32, 7).toString('base64')

/** Mail drop of this test run (mails are found by recipient, so files of other runs do not matter). */
export const TEST_MAIL_DIR = join(tmpdir(), `nmp-api-test-mail-${process.pid}`)

/** Config from the vitest environment plus test defaults; override any env variable by name. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    ...process.env, SECRET_ENCRYPTION_KEY: TEST_SECRET_KEY, LOG_LEVEL: 'silent', MAIL_DIR: TEST_MAIL_DIR, ...overrides,
  })
}

/** buildApp with the test config. Pass modules to mount only those (core hooks are always installed). */
export function buildTestApp(options: { modules?: readonly ApiModule[]; env?: Record<string, string> } = {}) {
  return buildApp({ config: testConfig(options.env), ...(options.modules === undefined ? {} : { modules: options.modules }) })
}

/** Closes the runtime and owner pools after the test file. */
export function closePoolsAfterAll(): void {
  afterAll(async () => {
    await closePool()
    await closeOwnerPool()
  })
}

export interface Caller {
  readonly cookie: string
}

export interface CallOptions {
  readonly method: InjectOptions['method']
  readonly url: string
  readonly as?: Caller
  readonly body?: unknown
  readonly headers?: Record<string, string>
  /** true = a fresh random key; a string = that key. */
  readonly idempotencyKey?: true | string
  /** Client address (request.ip); defaults to 127.0.0.1. */
  readonly remoteAddress?: string
}

/**
 * fastify.inject with the conventions of a browser client: session cookie, X-Requested-With on unsafe
 * methods (CSRF check), optional Idempotency-Key.
 */
export function call(app: FastifyInstance, options: CallOptions): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { 'x-requested-with': 'XMLHttpRequest', ...options.headers }
  if (options.as !== undefined) headers.cookie = options.as.cookie
  if (options.idempotencyKey !== undefined) {
    headers['idempotency-key'] = options.idempotencyKey === true ? randomUUID() : options.idempotencyKey
  }
  return app.inject({
    method: options.method,
    url: options.url,
    headers,
    ...(options.remoteAddress === undefined ? {} : { remoteAddress: options.remoteAddress }),
    ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
  })
}

/** The session cookie a response set (sign-in, MFA verification), as a caller for call(). */
export function sessionFrom(response: LightMyRequestResponse): Caller {
  const header = response.headers['set-cookie']
  const first = Array.isArray(header) ? header[0] : header
  if (first === undefined) throw new Error('the response set no cookie')
  return { cookie: first.split(';')[0]! }
}
