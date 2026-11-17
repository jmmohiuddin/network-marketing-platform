import { NextResponse, type NextRequest } from 'next/server'
import { contentSecurityPolicy, firebaseAuthDomain } from './lib/csp'
import { isAuthPage } from './lib/navigation'

const CSP_HEADER = 'Content-Security-Policy'

/**
 * A fresh nonce per page request; Next reads it from the request's CSP header and puts it on its scripts.
 * Firebase's sources go on the auth pages only (sign-in, and the invitation page that links to it client-side);
 * FIREBASE_AUTH_DOMAIN is read per request, so it is runtime configuration like the API's.
 */
export function proxy(request: NextRequest) {
  const firebase = isAuthPage(request.nextUrl.pathname) ? firebaseAuthDomain(process.env.FIREBASE_AUTH_DOMAIN) : null
  const policy = contentSecurityPolicy(btoa(crypto.randomUUID()), process.env.NODE_ENV === 'development', firebase)
  const headers = new Headers(request.headers)
  headers.set(CSP_HEADER, policy)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set(CSP_HEADER, policy)
  return response
}

// Pages only: not the API rewrite, static files or prefetches.
export const config = {
  matcher: [
    {
      source: '/((?!v1/|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
