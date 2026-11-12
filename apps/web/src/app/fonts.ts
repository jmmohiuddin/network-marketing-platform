import localFont from 'next/font/local'

// Self-hosted from npm (@fontsource-variable/*): no request to Google at build or run time (guidelines §3).
export const inter = localFont({
  src: '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
})

export const jetbrainsMono = localFont({
  src: '../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  variable: '--font-jetbrains-mono',
  display: 'swap',
  weight: '100 800',
})
