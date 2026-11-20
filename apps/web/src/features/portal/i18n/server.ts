// D-BM-12 server rendering of the portal: API reads from the server (API_URL) forwarding the caller's cookie, user agent,
// language and address; the request-cached GET /v1/me that the portal layout, its pages and the root layout's
// documentLang() share; 401 leaves for the portal sign-in.
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { ApiError } from '../../../lib/api'
import { MFA_VERIFY_PATH, PORTAL_HOME_PATH, PORTAL_SIGN_IN_PATH, SURFACE_HEADER, withNext } from '../../../lib/navigation'
import { l10n, type L10n } from '../format'
import type { PortalMe, PortalProfile } from '../types'
import { isLocale, negotiate, translator, type Locale, type MessageKey } from '.'

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000'
// x-forwarded-for is passed on as received (next/headers has no peer address): the web server is reachable only through
// the edge proxy, which sets it (docker-compose binds web to the private Caddy network), as the /v1 rewrite also assumes.
const FORWARDED = ['cookie', 'user-agent', 'accept-language', 'x-forwarded-for'] as const
/** The API's page size limit: longer lists are read page by page. */
const PAGE_MAX = 50

type Query = Readonly<Record<string, string | number | undefined>>

export interface Answer<T> {
  readonly data: T
  readonly meta: Readonly<Record<string, unknown>>
}

async function call(path: string, query: Query = {}): Promise<Response> {
  const incoming = await headers()
  const forward = new Headers({ accept: 'application/json' })
  for (const name of FORWARDED) {
    const value = incoming.get(name)
    if (value !== null) forward.set(name, value)
  }
  const url = new URL(path, API_URL)
  for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, String(value))
  try {
    return await fetch(url, { headers: forward, cache: 'no-store' })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'The request did not reach the service.')
  }
}

async function read<T>(response: Response): Promise<Answer<T>> {
  const body = await response.json().catch(() => undefined) as { data?: T; meta?: Record<string, unknown>; error?: Record<string, unknown> } | undefined
  if (response.ok && body !== undefined) return { data: body.data as T, meta: body.meta ?? {} }
  const error = body?.error
  if (error !== undefined && typeof error.code === 'string') {
    const id = typeof error.request_id === 'string' ? error.request_id : response.headers.get('x-request-id')
    throw new ApiError(response.status, error.code, typeof error.message === 'string' ? error.message : '', error.details ?? null, id)
  }
  throw new ApiError(response.status, 'SERVICE_UNAVAILABLE', 'The service did not answer as expected.', null, response.headers.get('x-request-id'))
}

/** A GET as the signed-in distributor; 401 redirects to the portal sign-in, other failures throw ApiError. */
export async function serverGet<T>(path: string, query?: Query): Promise<Answer<T>> {
  const response = await call(path, query)
  if (response.status === 401) redirect(PORTAL_SIGN_IN_PATH)
  return read<T>(response)
}

/** The result or the ApiError it failed with (a redirect still propagates). */
export async function settle<T>(promise: Promise<T>): Promise<T | ApiError> {
  try {
    return await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
}

/** The first `count` rows of a cursor-paged list (read in pages of at most 50), and whether more exist. */
export async function serverList<D, R>(path: string, query: Query, count: number, rowsOf: (data: D) => readonly R[]): Promise<{
  readonly data: D
  readonly rows: readonly R[]
  readonly more: boolean
}> {
  let cursor: string | undefined
  let first: D | undefined
  let rows: readonly R[] = []
  do {
    const answer = await serverGet<D>(path, { ...query, limit: Math.min(PAGE_MAX, count - rows.length), cursor })
    first ??= answer.data
    rows = [...rows, ...rowsOf(answer.data)]
    cursor = typeof answer.meta.next_cursor === 'string' ? answer.meta.next_cursor : undefined
  } while (cursor !== undefined && rows.length < count)
  return { data: first as D, rows, more: cursor !== undefined }
}

/** Rows asked for by a "Show more" link (?<name>=14): a multiple of `step`, at least `step`, at most `max`. */
export function shownCount(value: string | string[] | undefined, step: number, max = step * 20): number {
  const asked = Number(Array.isArray(value) ? value[0] : value)
  return Number.isInteger(asked) && asked > step ? Math.min(Math.ceil(asked / step) * step, max) : step
}

/** GET /v1/me once per request, or why it failed; no redirect, so documentLang can use it on sign-in pages. */
const readMe = cache(async (): Promise<PortalMe | ApiError> => settle(call('/v1/me').then((response) => read<PortalMe>(response)).then((answer) => answer.data)))

export interface PortalSession {
  readonly me: PortalMe
  readonly profile: PortalProfile
  readonly words: L10n
}

/**
 * The signed-in distributor with the words of the effective locale in the market zone. No session: the portal sign-in;
 * a staff session: the staff home; a pending second factor: the MFA step. The ApiError when /v1/me failed otherwise.
 */
export const portalSession = cache(async (): Promise<PortalSession | ApiError> => {
  const me = await readMe()
  if (me instanceof ApiError) {
    if (me.status === 401) redirect(PORTAL_SIGN_IN_PATH)
    return me
  }
  if (me.realm !== 'portal') redirect('/')
  if (me.participant === null || (me.mfa.enrolled && !me.mfa.verified)) redirect(withNext(MFA_VERIFY_PATH, PORTAL_HOME_PATH))
  const locale = isLocale(me.locale) ? me.locale : 'en'
  return { me, profile: me.participant, words: l10n(locale, me.participant.market.time_zone, translator(locale)) }
})

/** The locale of a page without a session (portal sign-in): Accept-Language among the supported locales, else en. */
export async function requestLocale(): Promise<Locale> {
  return negotiate((await headers()).get('accept-language'))
}

/**
 * The document language (root layout `<html lang>`): on the portal surface the session's effective locale, else the
 * Accept-Language match among the supported locales; en off the portal surface.
 */
export async function documentLang(): Promise<Locale> {
  if ((await headers()).get(SURFACE_HEADER) !== 'portal') return 'en'
  const me = await readMe()
  return !(me instanceof ApiError) && me.realm === 'portal' && isLocale(me.locale) ? me.locale : requestLocale()
}

/** generateMetadata of a portal page: its title in the session's locale. */
export function portalTitle(key: MessageKey): () => Promise<Metadata> {
  return async () => {
    const session = await portalSession()
    return { title: translator(session instanceof ApiError ? await requestLocale() : session.words.locale)(key) }
  }
}
