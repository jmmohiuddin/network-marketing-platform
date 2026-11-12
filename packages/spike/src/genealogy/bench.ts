/**
 * Genealogy spike benchmark (TS-29, OQ-05, OQ-29; NFR-PERF-07/-08, TR-GEN-03/-07).
 * Run through scripts/heavy.sh, e.g.
 *   scripts/heavy.sh node --expose-gc --max-old-space-size=3072 --import tsx packages/spike/src/genealogy/bench.ts --size 100000
 * Writes packages/spike/results/genealogy-<size>.json. Every number in it is measured on this machine.
 */
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { asOfParents, generateTree, prng, randInt } from './generate.js'
import { buildTree, isAncestor, rollUp, subtreeSizes, upline, type Tree } from './tree.js'
import {
  RELATIONSHIP_INDEXES, SCHEMA_SQL, TENANT, asOfPredicate, buildPathModel, moveSubtree, prefixIndexSql, querySql, writeTree,
} from './db.js'

const { values: arg } = parseArgs({
  options: {
    size: { type: 'string', default: '10000' }, chain: { type: 'string', default: '5000' }, seed: { type: 'string', default: '42' },
    k: { type: 'string', default: '128' }, samples: { type: 'string', default: '200' }, moves: { type: 'string', default: '10000' },
    db: { type: 'string', default: 'postgres://127.0.0.1:5432/nmp_spike' },
    excl: { type: 'string', default: 'add' }, // 'skip': bulk ADD CONSTRAINT EXCLUDE exceeded 900 s at 2M (measured)
  },
})
const SIZE = Number(arg.size)
const K = Number(arg.k)
const SAMPLES = Number(arg.samples)
const spec = { size: SIZE, seed: Number(arg.seed), deepChain: Number(arg.chain), changeRate: 0.01, correctionRate: 0.005, days: 730 }
const NOW = spec.days
const out: Record<string, unknown> = { spec, k: K, samples: SAMPLES, node: process.version, startedAt: new Date().toISOString() }
const log = (key: string, v: unknown): void => { out[key] = v; process.stdout.write(`${key} ${JSON.stringify(v)}\n`) }
const round = (x: number, d = 2): number => Math.round(x * 10 ** d) / 10 ** d

const gc = (globalThis as { gc?: () => void }).gc
function mem(): { rssMb: number; heapMb: number; peakRssMb: number } {
  gc?.()
  const m = process.memoryUsage()
  // resourceUsage().maxRSS is kilobytes on every platform (libuv normalises it)
  return { rssMb: round(m.rss / 2 ** 20), heapMb: round(m.heapUsed / 2 ** 20), peakRssMb: round(process.resourceUsage().maxRSS / 1024) }
}

async function timed<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const before = mem()
  const t0 = performance.now()
  const r = await fn()
  const ms = performance.now() - t0
  const after = mem()
  log(key, { ms: round(ms), rssMb: after.rssMb, rssDeltaMb: round(after.rssMb - before.rssMb), heapMb: after.heapMb, peakRssMb: after.peakRssMb })
  return r
}

function pct(ms: number[]): { p50: number; p95: number; max: number; n: number } {
  const s = [...ms].sort((a, b) => a - b)
  const at = (q: number): number => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!
  return { p50: round(at(0.5), 3), p95: round(at(0.95), 3), max: round(s[s.length - 1]!, 3), n: s.length }
}

async function latency(key: string, count: number, fn: (i: number) => Promise<unknown> | unknown): Promise<void> {
  await fn(0) // warm the prepared statement / JIT once; not counted
  const ms: number[] = []
  for (let i = 0; i < count; i++) {
    const t0 = performance.now()
    await fn(i)
    ms.push(performance.now() - t0)
  }
  log(key, pct(ms))
}

/** Engine snapshot load (SDD-07 §11): current edges as of now, keyset-paged, uuid -> dense index. */
async function loadFromDb(c: pg.Client): Promise<{ tree: Tree; ids: string[] }> {
  const n = (await c.query('select count(*)::int as n from position')).rows[0].n as number
  const index = new Map<string, number>()
  const ids: string[] = []
  const idx = (u: string): number => {
    let i = index.get(u)
    if (i === undefined) { i = ids.length; index.set(u, i); ids.push(u) }
    return i
  }
  const parent = new Int32Array(n).fill(-1)
  let last = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const page = await c.query({
      name: 'load-page', rowMode: 'array',
      text: `select child_position_id::text, parent_position_id::text from relationship where tenant_id = $1 and kind = 'sponsor'
        and child_position_id > $2 and ${asOfPredicate('$3', '$3')} order by child_position_id limit 200000`,
      values: [TENANT, last, NOW],
    })
    if (page.rows.length === 0) break
    for (const [ch, p] of page.rows as Array<[string, string]>) parent[idx(ch)] = idx(p)
    last = (page.rows[page.rows.length - 1] as [string, string])[0]
  }
  if (ids.length !== n) throw new Error(`loaded ${ids.length} positions, expected ${n}`)
  return { tree: buildTree(parent), ids }
}

const seqOf = (u: string): number => parseInt(u.slice(24), 16)

async function main(): Promise<void> {
  log('machine', { totalMemGb: round(os.totalmem() / 2 ** 30), freeMemGb: round(os.freemem() / 2 ** 30), cpus: os.cpus().length })
  log('baseline', mem())

  // 1. generation
  const g = await timed('generate', () => generateTree(spec))
  const counts = [0, 0, 0]
  for (let r = 0; r < g.rows.count; r++) counts[g.rows.event[r]!]!++
  log('rows', { total: g.rows.count, enrolment: counts[0], change: counts[1], correction: counts[2] })
  const genTree = buildTree(g.parent)
  const sizes0 = subtreeSizes(genTree)
  let maxDepth = 0
  let children = 0
  let maxChildren = 0
  let leaves = 0
  for (let i = 0; i < SIZE; i++) {
    if (genTree.depth[i]! > maxDepth) maxDepth = genTree.depth[i]!
    let k = 0
    for (let ch = genTree.firstChild[i]!; ch >= 0; ch = genTree.nextSibling[ch]!) k++
    children += k
    if (k > maxChildren && i !== 0) maxChildren = k
    if (k === 0) leaves++
  }
  log('shape', { maxDepth, leaves, maxChildrenNonRoot: maxChildren, rootChildren: (() => { let k = 0; for (let ch = genTree.firstChild[0]!; ch >= 0; ch = genTree.nextSibling[ch]!) k++; return k })(), meanChildren: round(children / SIZE, 3), largestNonChainSubtree: (() => { let m = 0; for (let i = spec.deepChain + 1; i < SIZE; i++) if (sizes0[i]! > m) m = sizes0[i]!; return m })() })

  const c = new pg.Client({ connectionString: arg.db, options: '-c search_path=genealogy,public -c statement_timeout=900000' })
  await c.connect()
  try {
    // 2. schema + bulk write + indexes + read model
    await c.query(SCHEMA_SQL)
    await timed('db.write', () => writeTree(c, g))
    for (const [name, sql] of RELATIONSHIP_INDEXES) {
      if (name === 'rel_no_overlap_excl' && arg.excl === 'skip') { log(`db.index.${name}`, 'skipped (--excl skip)'); continue }
      await timed(`db.index.${name}`, () => c.query(sql))
    }
    await c.query('analyze position; analyze relationship') // without stats the recursive build goes quadratic (measured)
    const built = await timed('db.pathModel.build', () => buildPathModel(c, NOW))
    if (built !== SIZE) throw new Error(`path_node has ${built} rows, expected ${SIZE}`)
    await timed('db.index.path_node_plain_gist', async () => {
      try { await c.query('create index path_node_plain_gist on path_node using gist (path)'); log('plainGist', { ok: true }) }
      catch (e) { log('plainGist', { ok: false, error: e instanceof Error ? e.message : String(e) }) }
    })
    await timed('db.index.path_node_prefix_gist', () => c.query(prefixIndexSql(K)))
    await c.query('analyze path_node')
    const sz = await c.query(`select relname, pg_relation_size(oid) as bytes from pg_class
      where relnamespace = 'genealogy'::regnamespace and relkind in ('r','i') order by relname`)
    log('db.sizesMb', Object.fromEntries(sz.rows.map((r) => [r.relname, round(Number(r.bytes) / 2 ** 20)])))
    log('db.totalMb', round(Number((await c.query(`select sum(pg_total_relation_size(oid)) as b from pg_class
      where relnamespace = 'genealogy'::regnamespace and relkind = 'r'`)).rows[0].b) / 2 ** 20))
    const deep = (await c.query(`select nlevel(path) as levels, octet_length(ltree2text(path)) as text_bytes,
      pg_column_size(path) as stored_bytes, pg_column_size(ltree_prefix(path, $1)) as prefix_bytes
      from path_node order by depth desc limit 1`, [K])).rows[0]
    const avg = (await c.query('select avg(pg_column_size(path))::float as a, avg(depth)::float as d, sum(pg_column_size(path))::bigint as s from path_node')).rows[0]
    log('ltree', { deepest: deep, avgStoredBytes: round(avg.a), avgDepth: round(avg.d), sumStoredMb: round(Number(avg.s) / 2 ** 20) })

    // 3. in-memory load from PostgreSQL (engine path)
    const { tree, ids } = await timed('mem.loadFromDb', () => loadFromDb(c))
    for (let i = 0; i < tree.n; i++) {
      const want = g.parent[seqOf(ids[i]!)]!
      const got = tree.parent[i]! < 0 ? -1 : seqOf(ids[tree.parent[i]!]!)
      if (want !== got) throw new Error(`loaded tree differs from generator at seq ${seqOf(ids[i]!)}`)
    }
    log('mem.loadVerified', true)
    const rand = prng(spec.seed + 1)
    const personal = new BigInt64Array(tree.n)
    for (let i = 0; i < tree.n; i++) personal[i] = BigInt(randInt(rand, 50_000))
    const rollMs: number[] = []
    let group: BigInt64Array = personal
    for (let r = 0; r < 5; r++) { const t0 = performance.now(); group = rollUp(tree, personal); rollMs.push(performance.now() - t0) }
    let total = 0n
    for (let i = 0; i < tree.n; i++) total += personal[i]!
    if (group[tree.root] !== total) throw new Error('root group volume != sum of personal volumes')
    log('mem.rollUp', { ...pct(rollMs), runs: 5, rootGroupMinor: String(group[tree.root]) })

    const buf = new Int32Array(10_000)
    const sample = (): number => randInt(rand, tree.n)
    await latency('mem.uplineFull.ms', SAMPLES, () => upline(tree, sample(), buf))
    const deepIdx = ids.findIndex((u) => seqOf(u) === spec.deepChain)
    {
      const t0 = performance.now()
      const lv = upline(tree, deepIdx, buf)
      log('mem.uplineDeepTail', { levels: lv, ms: round(performance.now() - t0, 4) })
    }
    {
      const t0 = performance.now()
      let s = 0
      for (let k = 0; k < 1_000_000; k++) s += upline(tree, sample(), buf, 10)
      log('mem.upline1MWalks10Levels', { ms: round(performance.now() - t0), levelsWalked: s })
    }

    // 4. read-model queries (NFR-PERF-07)
    const q = querySql(K)
    const plan = await c.query(`explain ${q.subtreeCount!.replace(/\$1/g, `'${TENANT}'`).replace(/\$2/g, `'${ids[tree.root]}'`)}`)
    log('plan.subtreeCount', plan.rows.map((r) => r['QUERY PLAN']))
    const prep = (name: string, values: unknown[]): Promise<pg.QueryResult> => c.query({ name, text: q[name]!, values })
    await latency('sql.authz.ms', SAMPLES, async () => {
      const t = sample()
      const lv = upline(tree, t, buf)
      const v = lv === 0 ? t : buf[randInt(rand, lv)]!
      const r = await prep('authz', [TENANT, ids[v], ids[t]])
      if (r.rows[0].allowed !== true) throw new Error('authz: ancestor not allowed')
    })
    await latency('sql.subtreeCount.ms', SAMPLES, () => prep('subtreeCount', [TENANT, ids[sample()]]))
    await latency('sql.subtreePage.ms', SAMPLES, () => prep('subtreePage', [TENANT, ids[sample()]]))
    await latency('sql.ancestors.ms', SAMPLES, () => prep('ancestors', [TENANT, ids[sample()]]))
    const sizes = subtreeSizes(tree)
    const chainMid = ids.findIndex((u) => seqOf(u) === Math.floor(spec.deepChain / 2))
    for (const [label, node] of [['root', tree.root], ['chainMid', chainMid], ['chainTail', deepIdx]] as const) {
      const t0 = performance.now()
      const cnt = (await prep('subtreeCount', [TENANT, ids[node]])).rows[0].n
      const t1 = performance.now()
      await prep('subtreePage', [TENANT, ids[node]])
      const t2 = performance.now()
      const anc = (await prep('ancestors', [TENANT, ids[node]])).rowCount
      const t3 = performance.now()
      if (cnt !== sizes[node]) throw new Error(`${label}: subtree count ${cnt} != ${sizes[node]}`)
      if (anc !== tree.depth[node]! + 1) throw new Error(`${label}: ancestors ${anc} != depth+1`)
      log(`sql.case.${label}`, { depth: tree.depth[node], subtreeSize: cnt, countMs: round(t1 - t0), pageMs: round(t2 - t1), ancestorsMs: round(t3 - t2) })
    }

    // 5. bitemporal (FR-GEN-003)
    await latency('sql.asOfParent.ms', SAMPLES, () => {
      const d = randInt(rand, NOW + 1)
      return prep('asOfParent', [TENANT, ids[sample()], d, d + randInt(rand, NOW + 1 - d)])
    })
    await latency('sql.asOfUpline.ms', SAMPLES, () => prep('asOfUpline', [TENANT, ids[sample()], NOW, NOW]))
    {
      const t0 = performance.now()
      const lv = (await prep('asOfUpline', [TENANT, ids[deepIdx], NOW, NOW])).rows[0].levels
      log('sql.asOfUplineDeepTail', { levels: lv, ms: round(performance.now() - t0) })
    }
    {
      const d = Math.floor(NOW / 2)
      const tKnown = Math.floor((NOW * 3) / 4)
      const t0 = performance.now()
      const dbCount = (await c.query(`select count(*)::int as n from relationship where tenant_id = $1 and kind = 'sponsor' and ${asOfPredicate('$2', '$3')}`, [TENANT, d, tKnown])).rows[0].n
      const ms = performance.now() - t0
      const ts = asOfParents(g.rows, SIZE, d, tKnown)
      let tsCount = 0
      for (let i = 0; i < SIZE; i++) if (ts[i]! >= 0) tsCount++
      if (dbCount !== tsCount) throw new Error(`as-of snapshot count db ${dbCount} != ts ${tsCount}`)
      log('sql.asOfSnapshotCount', { d, t: tKnown, edges: dbCount, ms: round(ms) })
    }

    // 6. subtree moves (NFR-PERF-08)
    let cur = tree
    let day = NOW + 1
    for (const target of String(arg.moves).split(',').map(Number)) {
      const sz2 = subtreeSizes(cur)
      let m = -1
      for (let i = 0; i < cur.n; i++) {
        if (i === cur.root || seqOf(ids[i]!) <= spec.deepChain) continue
        if (m < 0 || Math.abs(sz2[i]! - target) < Math.abs(sz2[m]! - target)) m = i
      }
      let np = -1
      while (np < 0) {
        const cand = randInt(rand, cur.n)
        if (cand !== m && cand !== cur.parent[m] && seqOf(ids[cand]!) > spec.deepChain && !isAncestor(cur, m, cand)) np = cand
      }
      const r = await timed(`db.move.${target}`, () => moveSubtree(c, K, ids[m]!, ids[np]!, day++))
      if (r.rows !== sz2[m]) throw new Error(`move rewrote ${r.rows} paths, subtree has ${sz2[m]}`)
      const check = (await c.query(`select (select path from path_node where position_id = $1) = (select path from path_node where position_id = $2) || text2ltree($3) as ok`,
        [ids[m], ids[np], seqOf(ids[m]!).toString(36)])).rows[0].ok
      if (check !== true) throw new Error('moved path is wrong')
      log(`db.move.${target}.detail`, { subtreeSize: sz2[m], relationshipMs: round(r.relMs), pathUpdateMs: round(r.pathMs), oldDepth: cur.depth[m], newParentDepth: cur.depth[np] })
      const next = cur.parent.slice()
      next[m] = np
      cur = buildTree(next)
    }
  } finally {
    await c.end()
  }
  log('final', mem())
  writeFileSync(new URL(`../../results/genealogy-${SIZE}.json`, import.meta.url), JSON.stringify(out, null, 2))
}


main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exit(1) })
