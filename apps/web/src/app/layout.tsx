import type { Metadata, Viewport } from 'next'
import { connection } from 'next/server'
import type { ReactNode } from 'react'
import 'material-symbols/outlined.css'
import { ApiProvider } from '../components/api-provider'
import { ToastProvider } from '../components/toast'
import '../styles/globals.css'
import { inter, jetbrainsMono } from './fonts'

export const metadata: Metadata = {
  title: { default: 'Staff application', template: '%s' },
  robots: { index: false, follow: false },
}

// viewportFit cover: the portal's pt-safe / pb-safe insets read the notch and home-indicator areas.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

// Rendered per request: Next adds the proxy's CSP nonce (proxy.ts) to its scripts only when it renders them.
// Body classes live on each layout's outer element (staff, vendor and card layouts differ: guidelines §2.3).
export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  await connection()
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <ToastProvider>
          <ApiProvider>{children}</ApiProvider>
        </ToastProvider>
      </body>
    </html>
  )
}
