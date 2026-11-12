import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// WCAG 2.2 contrast of the semantic colour pairs components use (light theme only: UI_UX 1.3, O-03).
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const declarations = new Map([...css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]))

function resolve(value: string): string {
  const reference = /^var\(--([\w-]+)\)$/.exec(value)
  if (reference === null) return value
  const target = declarations.get(reference[1]!)
  if (target === undefined) throw new Error(`undefined token ${reference[1]}`)
  return resolve(target)
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(resolve(`var(--${foreground})`)), luminance(resolve(`var(--${background})`))].sort((a, b) => b - a) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

const TEXT = 4.5
const NON_TEXT = 3
const PAIRS: readonly [string, string, number][] = [
  ...['bg-page', 'bg-surface', 'bg-subtle'].flatMap((bg): [string, string, number][] => [
    ['color-text-primary', `color-${bg}`, TEXT],
    ['color-text-secondary', `color-${bg}`, TEXT],
  ]),
  ['color-text-tertiary', 'color-bg-surface', TEXT],
  ['color-text-tertiary', 'color-bg-page', TEXT],
  ['color-text-link', 'color-bg-surface', TEXT],
  ['color-text-link', 'color-bg-page', TEXT],
  ['color-text-link', 'color-action-subtle', TEXT],
  ['color-text-on-action', 'color-action-primary', TEXT],
  ['color-text-on-action', 'color-action-primary-hover', TEXT],
  ['color-text-on-danger', 'color-danger-action', TEXT],
  ['color-danger-action', 'color-bg-surface', TEXT],
  ['color-success-text', 'color-success-bg', TEXT],
  ['color-warning-text', 'color-warning-bg', TEXT],
  ['color-danger-text', 'color-danger-bg', TEXT],
  ['color-info-text', 'color-info-bg', TEXT],
  ['color-success-icon', 'color-bg-surface', NON_TEXT],
  ['color-border-control', 'color-bg-surface', NON_TEXT],
  ['color-border-focus', 'color-bg-surface', NON_TEXT],
  ['color-border-focus', 'color-bg-page', NON_TEXT],
  ['color-text-on-support-frame', 'color-support-frame', TEXT],
  ['color-support-frame', 'color-bg-page', NON_TEXT],
]

describe('design tokens', () => {
  it('meet WCAG AA contrast', () => {
    const failures = PAIRS.filter(([fg, bg, min]) => contrast(fg, bg) < min)
      .map(([fg, bg, min]) => `${fg} on ${bg}: ${contrast(fg, bg).toFixed(2)} < ${min}`)
    expect(failures).toEqual([])
  })

  it('keep the UI-03 light values', () => {
    expect(resolve('var(--color-text-primary)')).toBe('#0F172A')
    expect(resolve('var(--color-action-primary)')).toBe('#1E4FA3')
  })

  it('ship no dark theme until its values are approved (UI_UX 1.3, O-03)', () => {
    expect(css).not.toMatch(/light-dark\(|data-theme|prefers-color-scheme: dark/)
    expect(css).toMatch(/color-scheme: light;/)
  })
})
