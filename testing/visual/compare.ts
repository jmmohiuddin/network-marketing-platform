// Visual comparison of one app screen against its Stitch reference. Usage is documented in testing/visual/README.md.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import type { Browser } from '@playwright/test'
import { PNG } from 'pngjs'
import { MEASURE_SCRIPT, compareLandmark, pixelDiff, type LandmarkResult, type Measured, type Probe } from './fidelity.ts'
import { REFERENCE_DIR, ROOT, SCREENSHOT_DIR, VIEWPORTS, launchBrowser, settle, stitchSource, viewportName, type StitchSource, type Viewport } from './stitch.ts'

type LandmarkConfig = { stitch: string; app: string; source?: string; viewports?: string[] }
type ScreenConfig = { stitch: string; module: string; screen: string; route: string; landmarks?: Record<string, Partial<LandmarkConfig> | null> }
type Config = { properties: Record<string, string[]>; landmarks: Record<string, LandmarkConfig>; screens: Record<string, ScreenConfig> }

const REPORT = join(ROOT, 'testing/VISUAL_REGRESSION_REPORT.md')
const RESULTS_DIR = join(ROOT, 'testing/visual/results')
const SESSION_COOKIE = 'nmp_session'
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/i

const { values: args } = parseArgs({
  options: { screen: { type: 'string' }, role: { type: 'string' }, url: { type: 'string' }, base: { type: 'string' }, self: { type: 'boolean', default: false } },
})
const config = JSON.parse(readFileSync(join(ROOT, 'testing/visual/screens.json'), 'utf8')) as Config
const screenId = Object.keys(config.screens).find((id) => id === args.screen || config.screens[id]?.stitch === args.screen)
if (!screenId) throw new Error(`--screen must be one of ${Object.keys(config.screens).join(', ')} or their Stitch folder`)
const screen = config.screens[screenId] as ScreenConfig
const role = args.self ? 'self-check' : (args.role ?? '')
if (!SAFE_NAME.test(role)) throw new Error('--role is required (letters, digits, dashes), e.g. --role compliance-officer')

const landmarks = Object.entries(config.landmarks).flatMap(([name, defaults]) => {
  const override = screen.landmarks?.[name]
  return override === null ? [] : [{ name, ...defaults, ...override, source: override?.source ?? defaults.source ?? screen.stitch }]
})

const sources = new Map<string, StitchSource>()
const sourceOf = (folder: string): StitchSource => {
  const existing = sources.get(folder)
  if (existing) return existing
  const created = stitchSource(folder)
  sources.set(folder, created)
  return created
}

function appUrl(): string {
  if (args.self) return sourceOf(screen.stitch).url
  if (args.url) return new URL(args.url).href
  if (!args.base) throw new Error('Pass --url <app page URL> or --base <app origin>')
  if (screen.route.includes('[')) throw new Error(`${screenId} route ${screen.route} has an id: pass --url`)
  return new URL(screen.route, args.base).href
}

const applies = (lm: (typeof landmarks)[number], vp: Viewport): boolean => !lm.viewports || lm.viewports.includes(viewportName(vp))

/** Measures every applicable landmark in its Stitch source (the screen itself, or the canonical shell). */
async function measureStitch(browser: Browser, vp: Viewport): Promise<Record<string, Measured>> {
  const out: Record<string, Measured> = {}
  const folders = [...new Set(landmarks.filter((lm) => applies(lm, vp)).map((lm) => lm.source))]
  for (const folder of folders) {
    const context = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await settle(page, sourceOf(folder).url)
    const probes = Object.fromEntries(landmarks.filter((lm) => lm.source === folder && applies(lm, vp))
      .map((lm): [string, Probe] => [lm.name, { selector: lm.stitch, props: config.properties[lm.name] ?? [] }]))
    Object.assign(out, await page.evaluate(`(${MEASURE_SCRIPT})(${JSON.stringify(probes)})`))
    await context.close()
  }
  return out
}

type ViewportResult = {
  viewport: string; screenshot: string; reference: string; diffImage: string
  mismatchPercent: number; diffPixels: number; referenceSize: string; actualSize: string; landmarks: LandmarkResult[]
}

async function runViewport(browser: Browser, url: string, outDir: string, vp: Viewport): Promise<ViewportResult> {
  const name = viewportName(vp)
  const referencePath = join(REFERENCE_DIR, screen.stitch, `${name}.png`)
  if (!existsSync(referencePath)) throw new Error(`Missing ${relative(ROOT, referencePath)}: run testing/visual/render-references.ts first`)

  const context = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' })
  const session = process.env.NMP_SESSION
  if (session && !args.self) await context.addCookies([{ name: SESSION_COOKIE, value: session, url: new URL(url).origin }])
  const page = await context.newPage()
  await settle(page, url)
  const screenshot = join(outDir, `${name}.png`)
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' })
  const appProbes = Object.fromEntries(landmarks.filter((lm) => applies(lm, vp))
    .map((lm): [string, Probe] => [lm.name, { selector: lm.app, props: config.properties[lm.name] ?? [] }]))
  // Self-check measures the Stitch side twice from fresh loads; a harness bug shows up as a difference.
  const appMeasured: Record<string, Measured> = args.self ? await measureStitch(browser, vp) : await page.evaluate(`(${MEASURE_SCRIPT})(${JSON.stringify(appProbes)})`)
  await context.close()

  const stitchMeasured = await measureStitch(browser, vp)
  const results = landmarks.filter((lm) => applies(lm, vp)).map((lm) => {
    const missing: Measured = { found: false, visible: false, text: '', values: {} }
    return compareLandmark(lm.name, config.properties[lm.name] ?? [], stitchMeasured[lm.name] ?? missing, appMeasured[lm.name] ?? missing)
  })

  const pixels = pixelDiff(PNG.sync.read(readFileSync(referencePath)), PNG.sync.read(readFileSync(screenshot)))
  const diffImage = join(outDir, `${name}.diff.png`)
  writeFileSync(diffImage, PNG.sync.write(pixels.diff))
  return {
    viewport: name, screenshot: relative(ROOT, screenshot), reference: relative(ROOT, referencePath), diffImage: relative(ROOT, diffImage),
    mismatchPercent: pixels.mismatchPercent, diffPixels: pixels.diffPixels, referenceSize: pixels.referenceSize, actualSize: pixels.actualSize,
    landmarks: results,
  }
}

const SEVERITY_ORDER = ['high', 'medium', 'info', 'none'] as const
const worst = (rows: LandmarkResult[]): string => SEVERITY_ORDER.find((s) => rows.some((r) => r.severity === s)) ?? 'none'
const cell = (v: string | null): string => (v === null ? '—' : `\`${v.replace(/\|/g, '\\|')}\``)

function markdown(when: string, url: string, patched: string[], rows: ViewportResult[]): string {
  const title = `${screenId} ${screen.screen} — role ${role}${args.self ? ' (harness self-check: Stitch vs Stitch)' : ''}`
  const lines = [
    `### ${when} · ${title}`, '',
    `- Page: \`${args.self ? `stitch:${screen.stitch}` : url}\` · Stitch: \`${screen.stitch}\`${patched.length ? ` · config brace patched: ${patched.join(', ')}` : ''}`,
    `- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.`, '',
    '| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => {
      const compared = r.landmarks.filter((l) => l.status !== 'absent-in-stitch')
      const matched = compared.filter((l) => l.status === 'match').length
      return `| ${r.viewport} | \`${r.screenshot}\` | \`${r.diffImage}\` | ${r.mismatchPercent}% | ${r.actualSize} / ${r.referenceSize} | ${matched}/${compared.length} | ${worst(r.landmarks)} |`
    }),
  ]
  const diffs = rows.flatMap((r) => r.landmarks.filter((l) => l.status !== 'match').flatMap((l) =>
    l.props.length === 0
      ? [`| ${r.viewport} | ${l.landmark} | ${l.status} | ${l.severity} | — | — | — |`]
      : l.props.filter((p) => !p.match).map((p) => `| ${r.viewport} | ${l.landmark} | ${l.status} | ${l.severity} | ${p.prop} | ${cell(p.stitch)} | ${cell(p.app)} |`)))
  lines.push('', diffs.length === 0 ? 'Style differences: none.' : 'Style differences:', '')
  if (diffs.length) lines.push('| Viewport | Landmark | Status | Severity | Property | Stitch | App |', '|---|---|---|---|---|---|---|', ...diffs)
  return lines.join('\n') + '\n\n'
}

const url = appUrl()
const outDir = join(SCREENSHOT_DIR, args.self ? 'self-check' : 'app', screen.module, screen.screen, role)
mkdirSync(outDir, { recursive: true })
const browser = await launchBrowser()
try {
  const rows: ViewportResult[] = []
  for (const vp of VIEWPORTS) rows.push(await runViewport(browser, url, outDir, vp))
  const when = new Date().toISOString()
  const patched = [...sources.entries()].filter(([, s]) => s.patched).map(([f]) => f)
  mkdirSync(RESULTS_DIR, { recursive: true })
  const resultFile = join(RESULTS_DIR, `${screenId}__${role}.json`)
  writeFileSync(resultFile, JSON.stringify({ when, screenId, stitch: screen.stitch, module: screen.module, screen: screen.screen, route: screen.route, role, url: args.self ? null : url, self: args.self, patched, viewports: rows }, null, 2))
  appendFileSync(REPORT, markdown(when, url, patched, rows))
  const worstOverall = worst(rows.flatMap((r) => r.landmarks))
  process.stdout.write(`${screenId} ${role}: ${rows.map((r) => `${r.viewport} ${r.mismatchPercent}%`).join(', ')}; worst style severity ${worstOverall}; ${relative(ROOT, resultFile)}\n`)
  process.exitCode = worstOverall === 'high' ? 1 : 0
} finally {
  await browser.close()
  for (const s of sources.values()) s.dispose()
}
