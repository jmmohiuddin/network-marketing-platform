/** nmp_spike schema `genealogy`: relationship (DATABASE.md ENT-05 shape) + path_node ltree read model (ENT-07). */
import type pg from 'pg'
import { EVENT_NAMES, type GeneratedTree } from './generate.js'

export const TENANT = '11111111-1111-4111-8111-111111111111'
const BATCH = 50_000

/**
 * Plain GiST on path cannot hold deep paths (index row > 8191 bytes past ~1,000 levels; internal keys carry two bounds).
 * Fallback measured here: GiST on the first K levels + exact recheck on the full path from the heap.
 */
export const prefixIndexSql = (k: number): string => `create index path_node_prefix_gist on path_node using gist (ltree_prefix(path, ${k}))`

export const SCHEMA_SQL = `
create extension if not exists ltree;
create extension if not exists btree_gist;
drop schema if exists genealogy cascade;
create schema genealogy;
set search_path = genealogy, public;
-- deterministic uuid for position seq s (spike only)
create function uid(s int) returns uuid immutable language sql as $$ select ('00000000-0000-4000-8000-' || lpad(to_hex(s), 12, '0'))::uuid $$;
create function dts(d int) returns timestamptz stable language sql as $$ select case when d < 0 then null else timestamptz '2025-01-01 00:00:00+00' + d * interval '1 day' end $$;
create function ltree_prefix(p ltree, k int) returns ltree immutable parallel safe language sql as $$ select case when nlevel(p) <= k then p else subpath(p, 0, k) end $$;
create table position (id uuid primary key, seq int not null unique, label text not null unique); -- label: base-36 seq, <= 6 chars => 8 bytes per ltree level
create table relationship (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, kind text not null check (kind in ('sponsor','placement')),
  parent_position_id uuid not null, child_position_id uuid not null, leg text,
  valid_from timestamptz not null, valid_to timestamptz, recorded_at timestamptz not null, superseded_at timestamptz,
  event_type text not null check (event_type in ('enrolment','change','correction','rule','migration')), case_id uuid,
  check (parent_position_id <> child_position_id));
create table path_node (
  tenant_id uuid not null, kind text not null, position_id uuid not null, path ltree not null, depth int not null,
  model_version bigint not null, subtree_count int, primary key (tenant_id, kind, position_id));
`

/** Indexes created after the bulk load (as a migration import would). Each is timed separately. */
export const RELATIONSHIP_INDEXES: Array<[string, string]> = [
  ['rel_child_idx', 'create index rel_child_idx on relationship (tenant_id, kind, child_position_id, valid_from)'],
  ['rel_parent_current_idx', 'create index rel_parent_current_idx on relationship (tenant_id, kind, parent_position_id) where superseded_at is null'],
  // Column order differs from DATABASE.md (tenant_id, kind first): constant leading GiST columns degrade the tree.
  // Measured at 100k (ADD CONSTRAINT incl. exclusion check): DATABASE.md order 89.8 s, child-first 19.8 s. Same semantics.
  ['rel_no_overlap_excl', `alter table relationship add constraint rel_no_overlap_excl exclude using gist
     (child_position_id with =, tstzrange(valid_from, valid_to) with &&, tenant_id with =, kind with =) where (superseded_at is null)`],
]

export async function writeTree(c: pg.Client, g: GeneratedTree): Promise<void> {
  const n = g.spec.size
  for (let lo = 0; lo < n; lo += BATCH) {
    const seqs = Array.from({ length: Math.min(BATCH, n - lo) }, (_, k) => lo + k)
    await c.query('insert into position (id, seq, label) select uid(s), s, l from unnest($1::int[], $2::text[]) t(s, l)',
      [seqs, seqs.map((s) => s.toString(36))])
  }
  const r = g.rows
  for (let lo = 0; lo < r.count; lo += BATCH) {
    const hi = Math.min(lo + BATCH, r.count)
    const a = (x: Int32Array): number[] => Array.from(x.subarray(lo, hi))
    await c.query(`insert into relationship (tenant_id, kind, parent_position_id, child_position_id, valid_from, valid_to, recorded_at, superseded_at, event_type)
      select $1, 'sponsor', uid(p), uid(ch), dts(vf), dts(vt), dts(ra), dts(sa), et
      from unnest($2::int[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[], $8::text[]) t(p, ch, vf, vt, ra, sa, et)`,
    [TENANT, a(r.parent), a(r.child), a(r.validFrom), a(r.validTo), a(r.recordedAt), a(r.supersededAt),
      Array.from(r.event.subarray(lo, hi), (e) => EVENT_NAMES[e]!)])
  }
}

/** Full read-model build from current relationship rows: recursive walk down with index nested loops. */
export async function buildPathModel(c: pg.Client, nowDay: number): Promise<number> {
  await c.query('begin')
  await c.query('set local enable_hashjoin = off; set local enable_mergejoin = off')
  const res = await c.query(`insert into path_node (tenant_id, kind, position_id, path, depth, model_version)
    with recursive t(id, path, depth) as (
      select p.id, text2ltree(p.label), 0 from position p where p.seq = 0
      union all
      select r.child_position_id, t.path || text2ltree(ch.label), t.depth + 1
      from t join relationship r on r.tenant_id = $1 and r.kind = 'sponsor' and r.parent_position_id = t.id
        and r.superseded_at is null and r.valid_from <= dts($2) and (r.valid_to is null or r.valid_to > dts($2))
      join position ch on ch.id = r.child_position_id)
    select $1, 'sponsor', id, path, depth, 1 from t`, [TENANT, nowDay])
  await c.query('commit')
  return res.rowCount ?? 0
}

/** FR-GEN-003 predicate: valid at D, known at T. $D/$T are day offsets. */
export const asOfPredicate = (d: string, t: string): string =>
  `valid_from <= dts(${d}) and (valid_to is null or valid_to > dts(${d})) and recorded_at <= dts(${t}) and (superseded_at is null or superseded_at > dts(${t}))`

export function querySql(k: number): Record<string, string> {
  // depth filter is cheap and runs before the detoast of long paths (deep anchors match many prefix candidates)
  const sub = `ltree_prefix(n.path, ${k}) <@ ltree_prefix(a.path, ${k}) and n.depth >= a.depth and n.path <@ a.path`
  const anchor = `with a as (select path, depth from path_node where tenant_id = $1 and kind = 'sponsor' and position_id = $2)`
  return {
    authz: `select v.path @> t.path as allowed, t.depth - v.depth as levels from path_node v, path_node t
      where v.tenant_id = $1 and v.kind = 'sponsor' and v.position_id = $2 and t.tenant_id = $1 and t.kind = 'sponsor' and t.position_id = $3`,
    subtreeCount: `${anchor} select count(*)::int as n from path_node n, a where n.tenant_id = $1 and n.kind = 'sponsor' and ${sub}`,
    subtreePage: `${anchor} select n.position_id, n.depth from path_node n, a where n.tenant_id = $1 and n.kind = 'sponsor' and ${sub}
      and n.depth <= a.depth + 2 order by n.path limit 50`,
    // Ancestors by label lookup: exact for any depth and needs no GiST.
    ancestors: `select n.position_id, n.depth from path_node n join position p on p.id = n.position_id
      where n.tenant_id = $1 and n.kind = 'sponsor' and p.label = any(string_to_array(ltree2text(
        (select path from path_node where tenant_id = $1 and kind = 'sponsor' and position_id = $2)), '.')) order by n.depth`,
    asOfParent: `select parent_position_id from relationship where tenant_id = $1 and kind = 'sponsor' and child_position_id = $2 and ${asOfPredicate('$3', '$4')}`,
    asOfUpline: `with recursive u(id, lvl) as (select $2::uuid, 0 union all
      select r.parent_position_id, u.lvl + 1 from u join relationship r on r.tenant_id = $1 and r.kind = 'sponsor'
        and r.child_position_id = u.id and ${asOfPredicate('$3', '$4')} where u.lvl < 10000)
      select count(*)::int - 1 as levels from u`,
  }
}

/**
 * Subtree move (FR-GEN-004 change + SDD-08 §8 rebuild), one transaction:
 * close the child's current row in place (C5), insert the change row, rewrite descendant paths with one UPDATE.
 */
export async function moveSubtree(c: pg.Client, k: number, child: string, newParent: string, day: number):
Promise<{ relMs: number; pathMs: number; rows: number }> {
  await c.query('begin')
  const t0 = performance.now()
  const closed = await c.query(`update relationship set valid_to = dts($3) where tenant_id = $1 and kind = 'sponsor' and child_position_id = $2
    and superseded_at is null and valid_to is null`, [TENANT, child, day])
  if (closed.rowCount !== 1) throw new Error(`expected one open row for ${child}, got ${closed.rowCount}`)
  await c.query(`insert into relationship (tenant_id, kind, parent_position_id, child_position_id, valid_from, recorded_at, event_type)
    values ($1, 'sponsor', $2, $3, dts($4), dts($4), 'change')`, [TENANT, newParent, child, day])
  const t1 = performance.now()
  const upd = await c.query(`update path_node n set path = np.path || subpath(n.path, nlevel(op.path) - 1),
      depth = n.depth - op.depth + np.depth + 1, model_version = n.model_version + 1
    from (select path, depth from path_node where tenant_id = $1 and kind = 'sponsor' and position_id = $2) op,
         (select path, depth from path_node where tenant_id = $1 and kind = 'sponsor' and position_id = $3) np
    where n.tenant_id = $1 and n.kind = 'sponsor' and ltree_prefix(n.path, ${k}) <@ ltree_prefix(op.path, ${k}) and n.depth >= op.depth and n.path <@ op.path`,
  [TENANT, child, newParent])
  await c.query('commit')
  return { relMs: t1 - t0, pathMs: performance.now() - t1, rows: upd.rowCount ?? 0 }
}
