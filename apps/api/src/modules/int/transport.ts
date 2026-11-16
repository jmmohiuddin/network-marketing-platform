import { createHmac, randomBytes } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

const SECRET_PREFIX = 'whsec_'
const SECRET_BYTES = 32
/** Response bytes read before the connection is dropped (the body is never used). */
const MAX_RESPONSE_BYTES = 4096
/** Whole host resolution (A and AAAA together); counted in an attempt's time budget (dispatch.ts). */
export const DNS_DEADLINE_MS = 5000
const DNS_QUERY_TIMEOUT_MS = 2000
const DNS_TRIES = 2

/** A new signing secret: whsec_ + base64 of 32 random bytes (Standard Webhooks). */
export function newWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString('base64')}`
}

/**
 * Standard Webhooks signature (D-B1-08): v1,<base64 HMAC-SHA256(key, id.timestamp.body)>, the key being the base64
 * part of the secret. Several secrets (rotation grace) give space-separated signatures.
 */
export function signatureHeader(secrets: readonly string[], id: string, timestamp: number, body: string): string {
  return secrets
    .map((secret) => {
      const key = Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64')
      return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`
    })
    .join(' ')
}

export interface ResolvedAddress {
  readonly address: string
  readonly family: number
}

/** Every address a host name resolves to. Throws when it does not resolve. */
export type WebhookResolver = (host: string) => Promise<readonly ResolvedAddress[]>

/**
 * c-ares queries (not getaddrinfo, which blocks a libuv pool thread that sign-in hashing also needs) cancelled at
 * deadlineMs, so a tenant's slow DNS cannot hold a dispatcher worker. `servers` replaces the system ones (tests).
 */
export function dnsResolver(options: { readonly deadlineMs: number; readonly servers?: readonly string[] }): WebhookResolver {
  return async (host) => {
    const family = isIP(host)
    if (family !== 0) return [{ address: host, family }]
    const resolver = new Resolver({ timeout: DNS_QUERY_TIMEOUT_MS, tries: DNS_TRIES })
    if (options.servers !== undefined) resolver.setServers(options.servers)
    const deadline = setTimeout(() => resolver.cancel(), options.deadlineMs)
    try {
      const [v4, v6] = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)])
      const found = [
        ...(v4.status === 'fulfilled' ? v4.value.map((address) => ({ address, family: 4 })) : []),
        ...(v6.status === 'fulfilled' ? v6.value.map((address) => ({ address, family: 6 })) : []),
      ]
      if (found.length === 0 && v4.status === 'rejected') throw v4.reason
      return found
    } finally {
      clearTimeout(deadline)
    }
  }
}

export const systemResolver: WebhookResolver = dnsResolver({ deadlineMs: DNS_DEADLINE_MS })

export interface DeliveryRequest {
  readonly url: URL
  /** URL host (no brackets): the TLS server name and Host header. */
  readonly host: string
  readonly port: number
  /** The vetted public address the socket must connect to (no second resolution). */
  readonly address: ResolvedAddress
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly timeoutMs: number
}

export type TransportError = 'CONNECTION_FAILED' | 'TLS_FAILED' | 'TIMEOUT'

export type DeliveryResult = { readonly kind: 'response'; readonly status: number } | { readonly kind: 'error'; readonly error: TransportError }

/** Sends one webhook POST. Never follows redirects; the caller judges the status. */
export type WebhookTransport = (request: DeliveryRequest) => Promise<DeliveryResult>

const TLS_CODE = /^(ERR_TLS_|ERR_SSL_)|CERT|SIGNATURE|^EPROTO$/

function classify(error: NodeJS.ErrnoException): TransportError {
  if (error.name === 'AbortError' || error.name === 'TimeoutError' || error.code === 'ABORT_ERR') return 'TIMEOUT'
  return TLS_CODE.test(error.code ?? '') ? 'TLS_FAILED' : 'CONNECTION_FAILED'
}

/**
 * node https with the vetted address pinned by `lookup`, the URL host as TLS server name, a total deadline, no
 * connection reuse and at most 4 KiB of the response read. `ca` replaces the trusted roots (tests with a local
 * TLS server); production uses the system roots.
 */
export function httpsTransport(options: { readonly ca?: string } = {}): WebhookTransport {
  return (delivery) =>
    new Promise((resolve) => {
      const pinned: LookupFunction = (_host, lookupOptions, callback) => {
        const { address, family } = delivery.address
        if (lookupOptions.all === true) callback(null, [{ address, family }])
        else callback(null, address, family)
      }
      const request = httpsRequest(
        {
          host: delivery.host, port: delivery.port, path: `${delivery.url.pathname}${delivery.url.search}`, method: 'POST',
          headers: { ...delivery.headers, 'content-length': Buffer.byteLength(delivery.body).toString() },
          lookup: pinned, agent: false, signal: AbortSignal.timeout(delivery.timeoutMs),
          ...(isIP(delivery.host) === 0 ? { servername: delivery.host } : {}),
          ...(options.ca === undefined ? {} : { ca: options.ca }),
        },
        (response) => {
          let read = 0
          response.on('data', (chunk: Buffer) => {
            read += chunk.length
            if (read >= MAX_RESPONSE_BYTES) response.destroy()
          })
          response.on('error', () => undefined) // the status is already known; a cut body is expected
          resolve({ kind: 'response', status: response.statusCode ?? 0 })
        },
      )
      request.on('error', (error: NodeJS.ErrnoException) => resolve({ kind: 'error', error: classify(error) }))
      request.end(delivery.body)
    })
}
