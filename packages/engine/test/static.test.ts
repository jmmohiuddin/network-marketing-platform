// TS-67 static checks over every file under src/: no binary float in money paths, no clock or randomness,
// no iteration over object keys, no tenant branch, no dependency beyond sibling modules and node:crypto.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SRC = join(import.meta.dirname, '../src')
const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.ts'))

// inStrings: the rule also looks inside string literals (a tenant id would be one).
const FORBIDDEN: ReadonlyArray<{ rule: string; pattern: RegExp; inStrings?: boolean }> = [
  { rule: 'parseFloat / parseInt', pattern: /\bparse(Float|Int)\b/ },
  { rule: 'Number( conversion', pattern: /\bNumber\(/ },
  { rule: 'float Math', pattern: /\bMath\.(round|floor|ceil|trunc|pow|sqrt|random|fround)\b/ },
  { rule: 'toFixed / toPrecision', pattern: /\.(toFixed|toPrecision)\(/ },
  { rule: 'float typed array', pattern: /\bFloat(32|64)Array\b/ },
  { rule: 'decimal or exponent number literal', pattern: /(?<![\w.$])(\d+\.\d+|\d+e[+-]?\d+)(?![\w.])|(?<![\w.$\])])\.\d+/i },
  { rule: 'unary plus conversion', pattern: /(?:^|[=(,:?[{;&|<>]|\breturn)\s*\+(?![+=])/ },
  { rule: 'clock', pattern: /\bDate\b|\bperformance\.now\b|\bprocess\.hrtime\b/ },
  { rule: 'object key iteration', pattern: /\bObject\.(keys|values|entries)\b|\bfor\s*\([^)]*\bin\b/ },
  { rule: 'tenant-specific code', pattern: /tenant/i, inStrings: true },
  { rule: 'import other than a sibling module or node:crypto', pattern: /\bfrom\s+'(?!\.{1,2}\/|node:crypto')/ },
  { rule: 'dynamic import or require', pattern: /\bimport\(|\brequire\(/ },
]

/** Comments removed; string/template contents blanked unless keepStrings (sibling import paths are kept). */
function codeLines(text: string, keepStrings = false): string[] {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, '')
  return withoutBlocks.split('\n').map((line) =>
    line
      .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (s) => (keepStrings || /^'(\.{1,2}\/|node:crypto')/.test(s) ? s.replace(/\/\//g, '') : "''"))
      .replace(/\/\/.*$/, ''),
  )
}

function violations(text: string): string[] {
  const plain = codeLines(text)
  const withStrings = codeLines(text, true)
  return FORBIDDEN.flatMap(({ rule, pattern, inStrings }) => ((inStrings ? withStrings : plain).some((l) => pattern.test(l)) ? [rule] : []))
}

describe('static: src stays pure, integer-only and deterministic (TS-67, BR-MNY-01, BR-PLN-05)', () => {
  test('src has the contract modules', () => {
    expect(files).toEqual(expect.arrayContaining(['errors.ts', 'index.ts', 'money.ts', 'pipeline.ts', 'tree.ts', 'types.ts']))
  })

  test.each(files)('%s', (name) => {
    expect(violations(readFileSync(join(SRC, name), 'utf8')), name).toEqual([])
  })

  test('the checks catch what they forbid', () => {
    const bad = ['const x = parseFloat(s)', 'const y = 0.1 * a', 'Math.round(v)', 'for (const k in obj) {}', 'Object.entries(o)', "if (t === 'tenant-a')", "import x from 'decimal.js'", 'const n = Number(b)', 'new Date()', 'const y = .5 * a', 'const z = +s', 'f(+s)', 'return +s']
    for (const line of bad) expect(violations(line), line).not.toEqual([])
    const fine = ["import { x } from './money.js'", "import { createHash } from 'node:crypto'", 'const r = 10n ** 12n', "throw new Error('rate 0.5 is bad')", 'const i = a[k + 1]!', 'for (let i = 0; i < n; ++i) {}', 'x += 1', 'const c = a + b', 'arr[0].x', 'const i = a[k]! + 1']
    for (const line of fine) expect(violations(line), line).toEqual([])
  })
})
