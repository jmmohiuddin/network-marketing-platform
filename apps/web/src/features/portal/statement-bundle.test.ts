import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// BUG-132 (NFR-PERF-06 statement budget): the scripts of the portal statement page are the client modules the portal
// layout and the statement reference, with everything they import at run time. Neither catalogue (the server hands the
// shell the session's one) nor a staff feature module may be among them.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLIENT_ENTRIES = ['features/portal/shell.tsx', 'features/portal/statement-sheet.tsx', 'features/portal/download-link.tsx']
const RUNTIME_IMPORT = /^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'|^import\s+'([^']+)'/gm

function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(from), specifier)
  const file = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((ending) => base + ending).find((path) => existsSync(path) && statSync(path).isFile())
  if (file === undefined) throw new Error(`${relative(SRC, from)} imports ${specifier}, which does not resolve`)
  return file
}

function clientGraph(entries: readonly string[]): string[] {
  const seen = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(RUNTIME_IMPORT)) {
      const next = resolveImport(file, match[1] ?? match[2]!)
      if (next !== null) visit(next)
    }
  }
  entries.forEach((entry) => visit(resolve(SRC, entry)))
  return [...seen].map((file) => relative(SRC, file))
}

describe('portal statement scripts (BUG-132)', () => {
  it('carry no catalogue and no staff feature module', () => {
    const graph = clientGraph(CLIENT_ENTRIES)
    expect(graph).toContain('features/portal/i18n/translate.ts')
    expect(graph.filter((file) => /^features\/portal\/i18n\/(en|de|index)\.ts$/.test(file) || (file.startsWith('features/') && !file.startsWith('features/portal/')))).toEqual([])
  })
})
