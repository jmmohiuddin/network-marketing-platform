// Renders every Stitch code.html at the four viewports into testing/ui-screenshots/reference/<sc_folder>/<WxH>.png.
// Usage: pnpm exec tsx testing/visual/render-references.ts [sc_folder …]   (needs network: Tailwind CDN, Google Fonts)
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REFERENCE_DIR, STITCH_DIR, VIEWPORTS, launchBrowser, settle, stitchSource, viewportName } from './stitch.ts'

const requested = process.argv.slice(2)
const folders = readdirSync(STITCH_DIR)
  .filter((f) => f.startsWith('sc_') && existsSync(join(STITCH_DIR, f, 'code.html')))
  .filter((f) => requested.length === 0 || requested.includes(f))
  .sort()
if (folders.length === 0) throw new Error(`No Stitch folder matches ${requested.join(', ')}`)

const browser = await launchBrowser()
const patched: string[] = []
try {
  for (const folder of folders) {
    const source = stitchSource(folder)
    if (source.patched) patched.push(folder)
    try {
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
        const page = await context.newPage()
        await settle(page, source.url)
        const dir = join(REFERENCE_DIR, folder)
        mkdirSync(dir, { recursive: true })
        await page.screenshot({ path: join(dir, `${viewportName(viewport)}.png`), fullPage: true, animations: 'disabled' })
        await context.close()
      }
    } finally {
      source.dispose()
    }
    process.stdout.write(`${folder}${source.patched ? ' (config brace patched)' : ''}\n`)
  }
} finally {
  await browser.close()
}
process.stdout.write(`Rendered ${folders.length} screens x ${VIEWPORTS.length} viewports. Patched: ${patched.join(', ') || 'none'}\n`)
