import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// TS-30 transfer-budget script (BUG-132) against a local server: compressed bytes of the document, scripts and
// stylesheets it references; nomodule scripts and fonts left out; the session cookie from NMP_BUDGET_COOKIE.
const SCRIPT = fileURLToPath(new URL('../scripts/statement-budget.mjs', import.meta.url))
const COOKIE = 'nmp_session=budget-test'
const BIG = randomBytes(200 * 1024) // incompressible: over the 190 KB budget (E-ADR-51) on its own

const page = (extra: string) => `<!doctype html><html><head>
<link rel="stylesheet" href="/_next/static/app.css"><link rel="preload" as="font" href="/_next/media/icons.woff2" crossorigin>
<link rel="preload" as="script" href="/_next/static/a.js"><script src="/_next/static/a.js" async></script>
<script src="/_next/static/legacy.js" nomodule></script>${extra}</head><body>Statement</body></html>`

const FILES: Readonly<Record<string, Buffer>> = {
  '/portal/earnings/run': Buffer.from(page('')),
  '/portal/earnings/big': Buffer.from(page('<script src="/_next/static/big.js?v=1&amp;x=2"></script>')),
  '/_next/static/app.css': Buffer.from('body{color:red}'.repeat(200)),
  '/_next/static/a.js': Buffer.from('console.info(1);'.repeat(500)),
  '/_next/static/big.js': BIG,
}
const requested: string[] = []
let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    requested.push(req.url ?? '')
    const body = FILES[path]
    if (body === undefined || req.headers.cookie !== COOKIE) {
      res.writeHead(body === undefined ? 404 : 401).end()
      return
    }
    res.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

function measure(path: string, cookie = COOKIE): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, base, path], { env: { ...process.env, NMP_BUDGET_COOKIE: cookie } }, (error, stdout) => {
      resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : -1, stdout })
    })
  })
}

describe('statement-budget.mjs (TS-30)', () => {
  it('sums the compressed document, scripts and stylesheets once each, without fonts or nomodule scripts', async () => {
    requested.length = 0
    const { code, stdout } = await measure('/portal/earnings/run')
    expect(code).toBe(0)
    expect(stdout).toMatch(/^PASS: .* KB transferred \(fonts excluded\), budget 190\.0 KB$/m)
    expect(requested.sort()).toEqual(['/_next/static/a.js', '/_next/static/app.css', '/portal/earnings/run'])
    const expected = ['/portal/earnings/run', '/_next/static/app.css', '/_next/static/a.js'].reduce((sum, path) => sum + gzipSync(FILES[path]!).length, 0)
    expect(stdout).toContain(`PASS: ${(expected / 1024).toFixed(1)} KB`)
  })

  it('fails above the budget (exit 1) and cannot measure without a session (exit 2)', async () => {
    const over = await measure('/portal/earnings/big')
    expect(over.code).toBe(1)
    expect(over.stdout).toContain('FAIL:')
    expect(requested).toContain('/_next/static/big.js?v=1&x=2')
    expect((await measure('/portal/earnings/run', 'nmp_session=other')).code).toBe(2)
  })
})
