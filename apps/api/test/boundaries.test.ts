import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g

interface SourceFile {
  readonly path: string // relative to src, '/' separated
  readonly source: string
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : []
  })
}

const moduleOf = (path: string): string | null => /^modules\/([^/]+)\//.exec(path)?.[1] ?? null

/**
 * ARCHITECTURE 4.1 rule 2: a module may import another module only through modules/<name>/index.ts, and
 * lib never imports a module. Returns "importer -> target" for every breach.
 */
export function boundaryViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = []
  for (const file of files) {
    for (const [, specifier] of file.source.matchAll(IMPORT)) {
      if (specifier === undefined || !specifier.startsWith('.')) continue
      const target = relative('.', join(dirname(file.path), specifier)).split(sep).join('/').replace(/\.js$/, '.ts')
      const targetModule = moduleOf(target)
      if (targetModule === null) continue
      const sameModule = moduleOf(file.path) === targetModule
      const viaIndex = target === `modules/${targetModule}/index.ts`
      const fromLib = file.path.startsWith('lib/')
      if (fromLib || (!sameModule && !viaIndex)) violations.push(`${file.path} -> ${target}`)
    }
  }
  return violations
}

describe('module boundaries', () => {
  test('no module imports another module\'s internals, and lib imports no module', () => {
    const files = walk(SRC).map((path) => ({
      path: relative(SRC, path).split(sep).join('/'),
      source: readFileSync(path, 'utf8'),
    }))

    expect(files.length).toBeGreaterThan(20)
    expect(boundaryViolations(files)).toEqual([])
  })

  test('the checker catches internal imports, including dynamic ones, and allows index imports', () => {
    const files: SourceFile[] = [
      { path: 'modules/aud/routes.ts', source: `import { x } from '../iam/users.js'\nimport { y } from '../ten/index.js'` },
      { path: 'modules/iam/grants.ts', source: `const m = await import('../aud/verify.js')\nimport { z } from './roles.js'` },
      { path: 'lib/audit.ts', source: `import { a } from '../modules/aud/index.js'` },
      { path: 'modules/index.ts', source: `import { iamModule } from './iam/index.js'` },
    ]

    expect(boundaryViolations(files)).toEqual([
      'modules/aud/routes.ts -> modules/iam/users.ts',
      'modules/iam/grants.ts -> modules/aud/verify.ts',
      'lib/audit.ts -> modules/aud/index.ts',
    ])
  })
})
