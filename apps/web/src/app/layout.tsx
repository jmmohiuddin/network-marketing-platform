import type { Metadata, Viewport } from 'next'
import { connection } from 'next/server'
import type { ReactNode } from 'react'
import { ApiProvider } from '../components/api-provider'
import { ToastProvider } from '../components/toast'
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/components.css'
import '../styles/layout.css'

export const metadata: Metadata = {
  title: { default: 'Staff application', template: '%s' },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

// Rendered per request: Next adds the proxy's CSP nonce (proxy.ts) to its scripts only when it renders them.
export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  await connection()
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <ApiProvider>{children}</ApiProvider>
        </ToastProvider>
      </body>
    </html>
  )
}
