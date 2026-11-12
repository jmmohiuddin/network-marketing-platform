import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page } from '@playwright/test'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const STITCH_DIR = join(ROOT, 'design/stitch/stitch_complete_ui_screen_design')
export const SCREENSHOT_DIR = join(ROOT, 'testing/ui-screenshots')
export const REFERENCE_DIR = join(SCREENSHOT_DIR, 'reference')

export const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const
export type Viewport = (typeof VIEWPORTS)[number]
export const viewportName = (v: { width: number; height: number }): string => `${v.width}x${v.height}`

/** Opening braces minus closing braces in the inline `tailwind.config = {…}` script (0 when balanced or absent). */
export function missingConfigBraces(html: string): number {
  const start = html.indexOf('tailwind.config')
  if (start < 0) return 0
  const end = html.indexOf('</script>', start)
  const config = html.slice(start, end < 0 ? undefined : end)
  return Math.max(0, (config.match(/{/g)?.length ?? 0) - (config.match(/}/g)?.length ?? 0))
}

export type StitchSource = { url: string; patched: boolean; dispose: () => void }

/**
 * File URL of a Stitch screen. sc_13, sc_24, sc_25 and sc_28 ship a tailwind config missing its last `}`, so the
 * Play CDN never gets the theme; those are rendered from a temporary copy with the brace appended.
 */
export function stitchSource(folder: string): StitchSource {
  const file = join(STITCH_DIR, folder, 'code.html')
  const html = readFileSync(file, 'utf8')
  const missing = missingConfigBraces(html)
  if (missing === 0) return { url: pathToFileURL(file).href, patched: false, dispose: () => {} }
  const dir = mkdtempSync(join(tmpdir(), 'stitch-'))
  const start = html.indexOf('tailwind.config')
  const end = html.indexOf('</script>', start)
  const copy = join(dir, 'code.html')
  writeFileSync(copy, html.slice(0, end) + '}'.repeat(missing) + html.slice(end))
  return { url: pathToFileURL(copy).href, patched: true, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Headless Chromium from the Playwright cache (@playwright/test 1.62.1 pairs with the cached chromium-1234). */
export const launchBrowser = (): Promise<Browser> => chromium.launch()

/** Loads a page and waits for network, web fonts and two frames so CDN Tailwind has applied its styles. */
export async function settle(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.evaluate('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))')
}
