// Run: node --test site/leads/server.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLeadServer, parseLead, rateLimited } from './server.mjs'

const NOW = new Date('2026-11-21T12:00:00Z')

test('parseLead trims, truncates and stamps a valid lead', () => {
  const { lead } = parseLead({ name: '  Alex  ', email: 'alex@example.com', message: 'x'.repeat(5000) }, NOW)
  assert.equal(lead.name, 'Alex')
  assert.equal(lead.message.length, 2000)
  assert.equal(lead.receivedAt, '2026-11-21T12:00:00.000Z')
})

test('parseLead needs a valid email but not a name', () => {
  assert.equal(parseLead({ email: 'a@b.co' }, NOW).lead.name, '')
  assert.match(parseLead({ name: 'A', email: 'nope' }).error, /email/)
  assert.match(parseLead({ name: 'A' }).error, /email/)
})

test('parseLead swallows honeypot submissions without a lead', () => {
  assert.deepEqual(parseLead({ name: 'Bot', email: 'bot@x.io', hp: 'http://spam' }), { lead: null })
})

test('rateLimited blocks the sixth hit within the window', () => {
  const results = Array.from({ length: 6 }, (_, i) => rateLimited('9.9.9.9', 1000 + i))
  assert.deepEqual(results, [false, false, false, false, false, true])
})

test('server stores a lead from JSON and a form post, and refuses a bad one', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'leads-')), 'leads.jsonl')
  const server = createLeadServer(file).listen(0)
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/api/lead`
  const post = (body, type) => fetch(url, { method: 'POST', headers: { 'Content-Type': type, 'X-Forwarded-For': `10.0.0.${Math.random() * 200 | 0}` }, body })
  try {
    assert.equal((await post(JSON.stringify({ name: 'Alex', email: 'alex@example.com', source: 'contact' }), 'application/json')).status, 200)
    assert.equal((await post('name=Sam&email=sam%40example.com', 'application/x-www-form-urlencoded')).status, 200)
    assert.equal((await post(JSON.stringify({ name: 'X', email: 'bad' }), 'application/json')).status, 400)
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    assert.deepEqual(lines.map((l) => l.name), ['Alex', 'Sam'])
  } finally {
    server.close()
  }
})
