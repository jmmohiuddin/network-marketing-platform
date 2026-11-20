#!/usr/bin/env node
// TS-30 / NFR-PERF-06 transfer budget (PLAN B-MKT D-BM-12, §P): bytes on the wire of a portal page cold, fonts excluded.
// Usage: NMP_BUDGET_COOKIE='nmp_session=…' node apps/web/scripts/statement-budget.mjs <baseUrl> <path>
// Fetches the document with Accept-Encoding gzip, br and the session cookie, then every <script src> (not nomodule)
// and every <link rel=stylesheet|modulepreload|preload as=script|style> it references, once each, and sums the
// compressed bytes received. Prints the breakdown; exits 1 above STATEMENT_TRANSFER_BUDGET_BYTES. No dependency.
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

const STATEMENT_TRANSFER_BUDGET_BYTES = 150 * 1024
const FONT = /\.(woff2?|ttf|otf|eot)(\?|$)/i
const TAG = /<(script|link)\b([^>]*)>/gi
const ATTRIBUTE = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

const attributes = (text) => Object.fromEntries([...text.matchAll(ATTRIBUTE)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '']))
const decodeEntities = (url) => url.replace(/&amp;/g, '&')

/** The script and stylesheet URLs a browser downloads for this HTML (absolute, unique, fonts left out). */
function assetUrls(html, base) {
  const found = new Set()
  for (const [, tag, text] of html.matchAll(TAG)) {
    const a = attributes(text)
    const rel = (a.rel ?? '').toLowerCase().split(/\s+/)
    const wanted = tag.toLowerCase() === 'script'
      ? a.src !== undefined && !('nomodule' in a)
      : a.href !== undefined && (rel.includes('stylesheet') || rel.includes('modulepreload') || (rel.includes('preload') && ['script', 'style'].includes(a.as)))
    const url = wanted ? new URL(decodeEntities(a.src ?? a.href), base) : null
    if (url !== null && !FONT.test(url.pathname) && a.as !== 'font') found.add(url.href)
  }
  return [...found]
}

/** GET url; resolves the status, the content-encoding and the body bytes as received (still compressed). */
function fetchRaw(url, cookie) {
  const target = new URL(url)
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest
  const headers = { 'accept-encoding': 'gzip, br', accept: '*/*', ...(cookie === undefined ? {} : { cookie }) }
  return new Promise((resolve, reject) => {
    const req = send(target, { method: 'GET', headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, encoding: res.headers['content-encoding'] ?? 'identity', body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

function decodedText(answer) {
  if (answer.encoding === 'br') return brotliDecompressSync(answer.body).toString('utf8')
  if (answer.encoding === 'gzip') return gunzipSync(answer.body).toString('utf8')
  return answer.body.toString('utf8')
}

async function main([baseUrl, path]) {
  if (baseUrl === undefined || path === undefined) {
    process.stderr.write('usage: statement-budget.mjs <baseUrl> <path> (session cookie in NMP_BUDGET_COOKIE)\n')
    return 2
  }
  const cookie = process.env.NMP_BUDGET_COOKIE
  const documentUrl = new URL(path, baseUrl).href
  const page = await fetchRaw(documentUrl, cookie)
  if (page.status !== 200) {
    process.stderr.write(`${documentUrl} answered ${page.status}: sign in and set NMP_BUDGET_COOKIE\n`)
    return 2
  }
  const rows = [{ url: documentUrl, kind: 'document', bytes: page.body.length, encoding: page.encoding }]
  for (const url of assetUrls(decodedText(page), documentUrl)) {
    const asset = await fetchRaw(url, cookie)
    if (asset.status !== 200) {
      process.stderr.write(`${url} answered ${asset.status}\n`)
      return 2
    }
    rows.push({ url, kind: /\.css(\?|$)/.test(new URL(url).pathname) ? 'stylesheet' : 'script', bytes: asset.body.length, encoding: asset.encoding })
  }
  const total = rows.reduce((sum, row) => sum + row.bytes, 0)
  for (const row of rows) process.stdout.write(`${(row.bytes / 1024).toFixed(1).padStart(8)} KB  ${row.kind.padEnd(10)} ${row.encoding.padEnd(8)} ${row.url}\n`)
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
  const within = total <= STATEMENT_TRANSFER_BUDGET_BYTES
  process.stdout.write(`${within ? 'PASS' : 'FAIL'}: ${kb(total)} transferred (fonts excluded), budget ${kb(STATEMENT_TRANSFER_BUDGET_BYTES)}\n`)
  return within ? 0 : 1
}

// 2 = the measurement could not be made (usage, refused request, network), 1 = over budget.
process.exitCode = await main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  return 2
})
