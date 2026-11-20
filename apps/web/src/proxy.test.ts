import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { SURFACE_HEADER } from './lib/navigation'
import { proxy } from './proxy'

// The request headers a page sees after the proxy (NextResponse.next({ request: { headers } }) carries them this way).
const surfaceOf = (url: string, sent?: string) => {
  const response = proxy(new NextRequest(url, { headers: sent === undefined ? {} : { [SURFACE_HEADER]: sent } }))
  return response.headers.get(`x-middleware-request-${SURFACE_HEADER}`)
}

describe('proxy surface header (D-BM-11 document language)', () => {
  it('marks /portal/** and the portal invitation as the portal surface', () => {
    expect(surfaceOf('http://localhost/portal')).toBe('portal')
    expect(surfaceOf('http://localhost/portal/earnings/abc')).toBe('portal')
    expect(surfaceOf('http://localhost/portal/signin')).toBe('portal')
    expect(surfaceOf('http://localhost/invitation?realm=portal')).toBe('portal')
  })

  it('drops a client-sent value everywhere else', () => {
    expect(surfaceOf('http://localhost/tax', 'portal')).toBeNull()
    expect(surfaceOf('http://localhost/invitation', 'portal')).toBeNull()
    expect(surfaceOf('http://localhost/portalx', 'portal')).toBeNull()
    expect(surfaceOf('http://localhost/signin', 'portal')).toBeNull()
  })
})
