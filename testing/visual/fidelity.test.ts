import { PNG } from 'pngjs'
import { describe, expect, test } from 'vitest'
import { compareLandmark, pixelDiff, sameValue, type Measured } from './fidelity.ts'
import { missingConfigBraces } from './stitch.ts'

const measured = (values: Record<string, string>): Measured => ({ found: true, visible: true, text: 'x', values })
const solid = (width: number, height: number, grey: number): PNG => {
  const png = new PNG({ width, height })
  for (let i = 0; i < png.data.length; i += 4) png.data.set([grey, grey, grey, 255], i)
  return png
}

describe('sameValue', () => {
  test('treats px lengths within half a pixel as equal', () => {
    expect(sameValue('width', '208px', '208.4px')).toBe(true)
    expect(sameValue('width', '208px', '288px')).toBe(false)
  })
  test('compares font stacks by their first family, ignoring quotes and case', () => {
    expect(sameValue('font-family', '"Inter", sans-serif', 'Inter, system-ui')).toBe(true)
    expect(sameValue('font-family', 'Inter', 'Arial')).toBe(false)
  })
  test('compares other values exactly', () => {
    expect(sameValue('color', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)')).toBe(true)
    expect(sameValue('box-shadow', 'none', 'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px')).toBe(false)
  })
})

describe('compareLandmark', () => {
  test('matches identical styles with no severity', () => {
    const r = compareLandmark('card', ['border-radius'], measured({ 'border-radius': '4px' }), measured({ 'border-radius': '4px' }))
    expect(r).toMatchObject({ status: 'match', severity: 'none' })
  })
  test('rates a shell drift high and a card drift medium', () => {
    expect(compareLandmark('sidebar', ['width'], measured({ width: '208px' }), measured({ width: '240px' })).severity).toBe('high')
    expect(compareLandmark('card', ['border-radius'], measured({ 'border-radius': '4px' }), measured({ 'border-radius': '8px' })).severity).toBe('medium')
  })
  test('reports an element missing from the app as high, and one Stitch lacks as info', () => {
    const absent: Measured = { found: false, visible: false, text: '', values: {} }
    expect(compareLandmark('title', ['font-size'], measured({ 'font-size': '20px' }), absent)).toMatchObject({ status: 'missing-in-app', severity: 'high' })
    expect(compareLandmark('title', ['font-size'], absent, measured({ 'font-size': '20px' }))).toMatchObject({ status: 'absent-in-stitch', severity: 'info' })
  })
})

describe('pixelDiff', () => {
  test('is 0% for identical images', () => {
    expect(pixelDiff(solid(10, 10, 100), solid(10, 10, 100)).mismatchPercent).toBe(0)
  })
  test('counts the extra height of a taller page as mismatch', () => {
    const r = pixelDiff(solid(10, 10, 0), solid(10, 20, 0))
    expect(r).toMatchObject({ mismatchPercent: 50, width: 10, height: 20, referenceSize: '10x10', actualSize: '10x20' })
  })
})

describe('missingConfigBraces', () => {
  test('counts the braces a truncated tailwind config lacks', () => {
    expect(missingConfigBraces('<script>tailwind.config={theme:{extend:{}}}</script>')).toBe(0)
    expect(missingConfigBraces('<script>tailwind.config={theme:{extend:{}}</script>')).toBe(1)
    expect(missingConfigBraces('<p>no config</p>')).toBe(0)
  })
})
