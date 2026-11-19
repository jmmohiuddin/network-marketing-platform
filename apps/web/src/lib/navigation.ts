export type Realm = 'tenant' | 'vendor' | 'portal'

/** A page the server lets the caller open (GET /v1/me navigation). */
export interface NavigationEntry {
  readonly key: string
  readonly path: string
  readonly label: string
}

export type NextStep = 'mfa_enrolment' | 'mfa_verification' | 'none'

export const SIGN_IN_PATH = '/signin'
export const VENDOR_SIGN_IN_PATH = '/signin/vendor'
export const MFA_ENROL_PATH = '/signin/enrol'
export const MFA_VERIFY_PATH = '/signin/mfa'
export const VENDOR_HOME_PATH = '/vendor'
export const PORTAL_HOME_PATH = '/portal'
export const PORTAL_SIGN_IN_PATH = '/portal/signin'
const AUTH_PREFIXES = ['/signin', '/invitation', PORTAL_SIGN_IN_PATH]
const ORIGIN = 'https://web.invalid'

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** Sign-in, MFA and invitation pages: never a target to come back to. */
export function isAuthPage(pathname: string): boolean {
  return AUTH_PREFIXES.some((prefix) => under(pathname, prefix))
}

/** A `next` value we may navigate to: a same-origin path that is not an auth page; anything else is null. */
export function safeNext(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !value.startsWith('/') || value.includes('\\')) return null
  let url: URL
  try {
    url = new URL(value, ORIGIN)
  } catch {
    return null
  }
  // The parser can turn a path into '//host' ('/.//evil.com'), which a navigation reads as another origin.
  if (url.origin !== ORIGIN || url.pathname.startsWith('//') || isAuthPage(url.pathname)) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/** The page to return to: the current page, or (on an auth page) the target it already carries. */
export function returnTarget(current: string): string | null {
  const url = new URL(current, ORIGIN)
  return isAuthPage(url.pathname) ? safeNext(url.searchParams.get('next')) : safeNext(current)
}

/** `path?next=<target>`; the home page needs no next. */
export function withNext(path: string, target: string | null): string {
  return target === null || target === '/' ? path : `${path}?next=${encodeURIComponent(target)}`
}

/** The realm whose pages hold `target` (a safe target: auth pages such as /portal/signin are never one). */
export function realmOf(target: string | null): Realm {
  const pathname = target?.split(/[?#]/)[0] ?? ''
  if (under(pathname, VENDOR_HOME_PATH)) return 'vendor'
  return under(pathname, PORTAL_HOME_PATH) ? 'portal' : 'tenant'
}

// The tenant_slug CHECK of migration 0002 (and the provisioning route's SLUG).
const TENANT_SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/** A ?tenant= value that is a well-formed tenant slug, else null (the server checks it again at sign-in). */
export function tenantSlug(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && TENANT_SLUG.test(value) ? value : null
}

/** Tenant sign-in with the company prefilled when the slug is known (invitation links carry it). */
export function tenantSignInPath(slug: string | null): string {
  return slug === null ? SIGN_IN_PATH : `${SIGN_IN_PATH}?tenant=${encodeURIComponent(slug)}`
}

const SIGN_IN_PATHS: Readonly<Record<Realm, string>> = { tenant: SIGN_IN_PATH, vendor: VENDOR_SIGN_IN_PATH, portal: PORTAL_SIGN_IN_PATH }
const HOMES: Readonly<Record<Realm, string>> = { tenant: '/', vendor: VENDOR_HOME_PATH, portal: PORTAL_HOME_PATH }

export function signInPathFor(realm: Realm): string {
  return SIGN_IN_PATHS[realm]
}

/** The realm's sign-in page after sign-out; the portal one names the member's company when known (no company field). */
export function signedOutPath(realm: Realm, slug: string | null = null): string {
  const tenant = realm === 'portal' && slug !== null ? `tenant=${encodeURIComponent(slug)}&` : ''
  return `${signInPathFor(realm)}?${tenant}reason=signed_out`
}

export function defaultHome(realm: Realm): string {
  return HOMES[realm]
}

/** Where an auth error code sends the user from `current` (path + query), or null for other codes. */
export function authRedirectPath(code: string, current: string): string | null {
  const target = returnTarget(current)
  switch (code) {
    case 'UNAUTHENTICATED':
      return withNext(signInPathFor(realmOf(target)), target)
    case 'MFA_ENROLMENT_REQUIRED':
      return withNext(MFA_ENROL_PATH, target)
    case 'MFA_VERIFICATION_REQUIRED':
      return withNext(MFA_VERIFY_PATH, target)
    default:
      return null
  }
}

/** After a successful password sign-in: the MFA step the server asks for, else the target. */
export function afterSignInPath(nextStep: NextStep, target: string): string {
  if (nextStep === 'mfa_enrolment') return withNext(MFA_ENROL_PATH, target)
  if (nextStep === 'mfa_verification') return withNext(MFA_VERIFY_PATH, target)
  return target
}

/** The entry the current page belongs to: the longest entry path that contains it. */
export function activeEntry(pathname: string, entries: readonly NavigationEntry[]): NavigationEntry | undefined {
  return entries
    .filter((entry) => under(pathname, entry.path))
    .reduce<NavigationEntry | undefined>((best, entry) => (best === undefined || entry.path.length > best.path.length ? entry : best), undefined)
}
