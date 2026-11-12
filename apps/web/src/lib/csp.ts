/**
 * The Content-Security-Policy of every page (defence in depth against script injection): scripts only from this
 * origin and carrying the request's nonce, no framing, API calls to this origin only (the /v1 rewrite).
 * Development adds what React's dev tooling needs (eval; styles injected by hot reload without a nonce).
 */
export function contentSecurityPolicy(nonce: string, development: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]
  return directives.join('; ')
}
