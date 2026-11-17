import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// TS-67 web part: wallets, e-pins and held funds are refused content (X-01..X-24). Static scan of every non-test
// source file under apps/web/src, so a screen, label or type that names a wallet fails here first.
describe('refused content in the web app', () => {
  it('never uses the word "wallet" outside tests', () => {
    const root = new URL('./', import.meta.url)
    const offenders = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(ts|tsx|css)$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => /wallet/i.test(readFileSync(new URL(file, root), 'utf8')))
    expect(offenders).toEqual([])
  })
})
