import type { NextConfig } from 'next'

// The API is served under the web origin, so the HttpOnly SameSite=Strict session cookie is first-party.
// Rewrites are resolved at build time: set API_URL before `next build` when the API is not on the default.
const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '')

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${apiUrl}/v1/:path*` }]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ]
  },
}

export default nextConfig
