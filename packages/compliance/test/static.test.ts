import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SRC = join(import.meta.dirname, '../src')
const files = readdirSync(SRC).filter((name) => name.endsWith('.ts'))

const FORBIDDEN: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'parseFloat', pattern: /parseFloat/ },
  { name: 'Number( conversion of an amount', pattern: /\bNumber\(/ },
  { name: 'Math.round', pattern: /Math\.round/ },
  { name: 'toFixed', pattern: /\.toFixed\(/ },
  { name: 'float division or multiplication by 100', pattern: /[/*]\s*100(?![n\d])/ },
  { name: 'Date.now / new Date', pattern: /Date\.now|new Date/ },
  { name: 'Math.random', pattern: /Math\.random/ },
  { name: 'import of anything but a sibling module', pattern: /from\s+'(?!\.\/)/ },
]

describe('static: no float arithmetic, clock, randomness or dependencies in src', () => {
  test('src has the expected modules', () => {
    expect(files).toEqual(expect.arrayContaining(['index.ts', 'percent.ts', 'r1.ts', 'r2.ts', 'r3.ts', 'r4.ts', 'r5.ts', 'types.ts']))
  })

  test.each(files)('%s', (name) => {
    const code = readFileSync(join(SRC, name), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    for (const { name: rule, pattern } of FORBIDDEN) {
      const offending = code.filter((l) => pattern.test(l))
      expect(offending, `${name}: ${rule}`).toEqual([])
    }
  })
})
