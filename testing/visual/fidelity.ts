import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

export type Probe = { selector: string; props: string[] }
export type Measured = { found: boolean; visible: boolean; text: string; values: Record<string, string> }
export type PropResult = { prop: string; stitch: string | null; app: string | null; match: boolean }
export type LandmarkResult = {
  landmark: string
  status: 'match' | 'mismatch' | 'missing-in-app' | 'absent-in-stitch'
  severity: 'high' | 'medium' | 'info' | 'none'
  stitchText: string
  appText: string
  props: PropResult[]
}

/** Shell and the primary action carry the layout; a drift there is visible on every screen. */
const HIGH_IMPACT = new Set(['header', 'sidebar', 'page', 'primaryButton'])
const PX_TOLERANCE = 0.5

/**
 * Runs in the page (passed as a string so the bundler cannot inject helpers). `background` is the first
 * non-transparent background of the element or an ancestor, i.e. the colour the user actually sees.
 */
export const MEASURE_SCRIPT = `(probes) => Object.fromEntries(Object.entries(probes).map(([name, probe]) => {
  const el = document.querySelector(probe.selector)
  if (!el) return [name, { found: false, visible: false, text: '', values: {} }]
  const style = getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  const values = {}
  for (const prop of probe.props) {
    if (prop === 'background') {
      let node = el
      let colour = 'rgba(0, 0, 0, 0)'
      while (node) {
        const bg = getComputedStyle(node).backgroundColor
        if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') { colour = bg; break }
        node = node.parentElement
      }
      values[prop] = colour
    } else if (prop === 'width' || prop === 'height') {
      values[prop] = rect[prop] + 'px'
    } else {
      values[prop] = style.getPropertyValue(prop)
    }
  }
  const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  return [name, { found: true, visible, text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60), values }]
}))`

const normaliseFont = (v: string): string => (v.split(',')[0] ?? '').replace(/["']/g, '').trim().toLowerCase()

/** Equal after normalisation: px lengths within half a pixel, font stacks by their first family. */
export function sameValue(prop: string, a: string, b: string): boolean {
  if (prop === 'font-family') return normaliseFont(a) === normaliseFont(b)
  const px = /^(-?\d+(?:\.\d+)?)px$/
  const ma = a.trim().match(px)
  const mb = b.trim().match(px)
  if (ma && mb) return Math.abs(Number(ma[1]) - Number(mb[1])) <= PX_TOLERANCE
  return a.trim() === b.trim()
}

export function compareLandmark(landmark: string, props: string[], stitch: Measured, app: Measured): LandmarkResult {
  const base = { landmark, stitchText: stitch.text, appText: app.text }
  if (!stitch.found || !stitch.visible) {
    return { ...base, status: 'absent-in-stitch', severity: 'info', props: [] }
  }
  if (!app.found || !app.visible) {
    const rows = props.map((prop) => ({ prop, stitch: stitch.values[prop] ?? null, app: null, match: false }))
    return { ...base, status: 'missing-in-app', severity: 'high', props: rows }
  }
  const rows = props.map((prop) => {
    const s = stitch.values[prop] ?? ''
    const a = app.values[prop] ?? ''
    return { prop, stitch: s, app: a, match: sameValue(prop, s, a) }
  })
  const ok = rows.every((r) => r.match)
  const severity = ok ? 'none' : HIGH_IMPACT.has(landmark) ? 'high' : 'medium'
  return { ...base, status: ok ? 'match' : 'mismatch', severity, props: rows }
}

export type PixelResult = {
  mismatchPercent: number
  diffPixels: number
  width: number
  height: number
  referenceSize: string
  actualSize: string
  diff: PNG
}

/** Pads both images onto a white canvas of the larger size, so a height difference counts as mismatch. */
export function pad(image: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height })
  out.data.fill(255)
  PNG.bitblt(image, out, 0, 0, image.width, image.height, 0, 0)
  return out
}

export function pixelDiff(reference: PNG, actual: PNG): PixelResult {
  const width = Math.max(reference.width, actual.width)
  const height = Math.max(reference.height, actual.height)
  const diff = new PNG({ width, height })
  const diffPixels = pixelmatch(pad(reference, width, height).data, pad(actual, width, height).data, diff.data, width, height, {
    threshold: 0.1,
  })
  return {
    mismatchPercent: Math.round((diffPixels / (width * height)) * 10_000) / 100,
    diffPixels,
    width,
    height,
    referenceSize: `${reference.width}x${reference.height}`,
    actualSize: `${actual.width}x${actual.height}`,
    diff,
  }
}
