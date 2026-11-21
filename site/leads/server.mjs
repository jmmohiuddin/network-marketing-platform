// Lead capture for the static landing pages: POST /api/lead appends one JSON line to LEADS_FILE.
// No dependencies. shortcut: in-memory rate limit and no e-mail notification; add SMTP/webhook when volume needs it.
import { createServer } from 'node:http'
import { appendFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'

const MAX_BODY_BYTES = 8 * 1024
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 5
const MAX_TRACKED_IPS = 10_000
const FIELD_LIMITS = { name: 120, email: 200, company: 160, url: 200, spend: 60, bottleneck: 60, message: 2000, source: 60 }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const hits = new Map()

/** Drops clients whose last hit is older than the window. */
export function sweepRateLimit(now = Date.now()) {
  for (const [ip, times] of hits) if (now - times[times.length - 1] >= RATE_WINDOW_MS) hits.delete(ip)
}

export function trackedClients() {
  return hits.size
}

export function rateLimited(ip, now = Date.now()) {
  if (!hits.has(ip) && hits.size >= MAX_TRACKED_IPS) {
    sweepRateLimit(now)
    // Still full of live clients: evict the oldest (Map keeps insertion order) so memory stays bounded.
    if (hits.size >= MAX_TRACKED_IPS) hits.delete(hits.keys().next().value)
  }
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  recent.push(now)
  hits.delete(ip) // re-insert so the most recently active client is last in eviction order
  hits.set(ip, recent)
  return recent.length > RATE_MAX
}

/** Client address from Caddy's X-Forwarded-For, accepted only when it is a valid IP; else the socket address. */
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  return isIP(forwarded) ? forwarded : req.socket.remoteAddress ?? 'unknown'
}

/** Returns { lead } or { error }. A filled honeypot ("hp") is accepted silently as { lead: null }. Name is optional (the home audit form has none). */
export function parseLead(raw, now = new Date()) {
  if (typeof raw !== 'object' || raw === null) return { error: 'Invalid request' }
  if (raw.hp) return { lead: null }
  const lead = { receivedAt: now.toISOString() }
  for (const [key, limit] of Object.entries(FIELD_LIMITS)) {
    const value = raw[key]
    lead[key] = typeof value === 'string' ? value.trim().slice(0, limit) : ''
  }
  if (!EMAIL.test(lead.email)) return { error: 'Please enter a valid email address' }
  return { lead }
}

async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function createLeadServer(leadsFile) {
  const sweeper = setInterval(sweepRateLimit, RATE_WINDOW_MS)
  sweeper.unref()
  return createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/lead') return send(res, 404, { error: 'Not found' })
    // Caddy sets X-Forwarded-For; the container port is private, so the header is trusted.
    const ip = clientIp(req)
    if (rateLimited(ip)) return send(res, 429, { error: 'Too many requests, try again in a minute' })
    try {
      const text = await readBody(req)
      const raw = req.headers['content-type']?.includes('application/json')
        ? JSON.parse(text)
        : Object.fromEntries(new URLSearchParams(text))
      const { lead, error } = parseLead(raw)
      if (error) return send(res, 400, { error })
      if (lead) await appendFile(leadsFile, JSON.stringify(lead) + '\n')
      return send(res, 200, { ok: true })
    } catch (err) {
      if (err.status === 413) return send(res, 413, { error: 'Message too large' })
      if (err instanceof SyntaxError) return send(res, 400, { error: 'Invalid request' })
      console.error('lead save failed', err)
      return send(res, 500, { error: 'Could not save your request, please try again' })
    }
  })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8080)
  createLeadServer(process.env.LEADS_FILE ?? '/data/leads.jsonl').listen(port, '0.0.0.0', () =>
    console.log(`leads listening on ${port}`),
  )
}
