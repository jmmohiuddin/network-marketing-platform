/**
 * The Content-Security-Policy of every page (defence in depth against script injection): scripts only from this
 * origin and carrying the request's nonce, no framing, API calls to this origin only (the /v1 rewrite).
 * Development adds what React's dev tooling needs (eval; styles injected by hot reload without a nonce).
 * firebaseAuthDomain (sign-in pages, when Firebase sign-in is configured) adds exactly what Firebase Auth uses.
 * A document keeps its CSP across soft navigations, so the auth pages are left with a full page load (leavePage);
 * the one exception is the page after MFA enrolment, which keeps the wider policy until the next page load.
 */
export function contentSecurityPolicy(nonce: string, development: boolean, firebaseAuthDomain: string | null = null): string {
  const firebase = firebaseAuthDomain !== null
  const directives = [
    "default-src 'self'",
    // apis.google.com: the gapi loader of the Google popup. Browsers with 'strict-dynamic' ignore host sources and
    // trust it as loaded by our nonce-carrying bundle; the host is for older browsers that do not know 'strict-dynamic'.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${firebase ? ' https://apis.google.com' : ''}${development ? " 'unsafe-eval'" : ''}`,
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // identitytoolkit: sign-in and account calls; securetoken: ID token refresh (getIdToken(true)).
    `connect-src 'self'${firebase ? ' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com' : ''}`,
    // The hidden iframe (authDomain/__/auth/iframe) through which the popup hands back its result.
    ...(firebase ? [`frame-src 'self' https://${firebaseAuthDomain}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]
  return directives.join('; ')
}

// A host name with an optional port; anything else could change the header (a ';' starts a new directive).
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i

/** FIREBASE_AUTH_DOMAIN of the web server, or null when unset or not a host name. */
export function firebaseAuthDomain(value: string | undefined): string | null {
  const host = value?.trim() ?? ''
  return HOST.test(host) ? host : null
}
