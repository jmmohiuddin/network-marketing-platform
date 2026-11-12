import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import config from '../../tailwind.config'

// The Stitch theme is the design source (guidelines §2.2): the app's Tailwind colours must equal the canonical JSON.
const stitch = JSON.parse(readFileSync(new URL('../../../../design/stitch/tailwind-theme.json', import.meta.url), 'utf8')) as {
  readonly colors: Readonly<Record<string, string>>
}
const colors = config.theme?.extend?.colors as Readonly<Record<string, string>>

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(colors[foreground]!), luminance(colors[background]!)].sort((a, b) => b - a) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

// WCAG 2.2 text pairs the components use (UI_UX §1.3 light theme only).
const TEXT_PAIRS: readonly [string, string][] = [
  ['on-surface', 'surface-container-lowest'], ['on-surface', 'background'], ['secondary', 'surface-container-lowest'],
  ['secondary', 'surface-container-low'], ['on-surface-variant', 'surface-container-lowest'], ['on-primary', 'primary'],
  ['on-primary', 'primary-container'], ['primary', 'primary-fixed'], ['on-tertiary-fixed', 'tertiary-fixed'],
  ['on-error-container', 'error-container'], ['error', 'surface-container-lowest'], ['on-error', 'error'],
  ['inverse-on-surface', 'inverse-surface'], ['primary', 'surface-container-lowest'],
]

describe('Stitch theme', () => {
  it('has exactly the canonical Stitch colours', () => {
    expect(colors).toEqual(stitch.colors)
  })

  it.each(TEXT_PAIRS)('%s on %s reaches 4.5:1', (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  it('ships the light theme only: class dark mode that nothing sets, no colour-scheme media query', () => {
    const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8')
    expect(config.darkMode).toBe('class')
    expect(css).toContain('color-scheme: light')
    expect(css).not.toContain('prefers-color-scheme')
  })
})
