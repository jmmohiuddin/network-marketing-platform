import { withSystem, type Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { defineSystemJob, type JobContext, type SystemJob } from '../../lib/jobs.js'
import { CURRENT, type Kind } from './read-model.js'

export const REBUILD_JOB_NAME = 'gen.paths.rebuild'

/** A build that must not replace the serving version (FR-GEN-008 validation). */
class BuildRefused extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

interface StaleModel {
  readonly tenant_id: string
  readonly kind: Kind
}

export type RebuildOutcome =
  | { readonly kind: Kind; readonly result: 'rebuilt'; readonly version: string; readonly nodes: number; readonly stillStale: boolean }
  | { readonly kind: Kind; readonly result: 'skipped' }

// Roots are the positions without a current row of the kind; every other position hangs below its current parent.
// Index nested loops as measured by the spike (E-ADR-32), after ANALYZE.
const BUILD_SQL = `
  INSERT INTO gen_path_build (id, parent, path, depth)
  WITH RECURSIVE t (id, parent, path, depth) AS (
    SELECT p.id, NULL::uuid, text2ltree(p.label), 0 FROM position p
    WHERE NOT EXISTS (SELECT 1 FROM relationship r WHERE r.kind = $1 AND r.child_position_id = p.id AND ${CURRENT('r')})
    UNION ALL
    SELECT r.child_position_id, t.id, t.path || text2ltree(c.label), t.depth + 1
    FROM t JOIN relationship r ON r.kind = $1 AND r.parent_position_id = t.id AND ${CURRENT('r')}
    JOIN position c ON c.id = r.child_position_id)
  SELECT id, parent, path, depth FROM t`

/** Subtree counts by one reverse pass over the levels (no prefix count over the subtree, PLAN B2 2.5). */
async function countDescendants(tx: Tx): Promise<void> {
  const { rows } = await tx.query<{ max: number | null }>('SELECT max(depth) AS max FROM gen_path_build')
  for (let depth = rows[0]?.max ?? 0; depth >= 1; depth -= 1) {
    await tx.query(
      `UPDATE gen_path_build b SET descendants = s.n
       FROM (SELECT parent, sum(descendants + 1)::int AS n FROM gen_path_build WHERE depth = $1 GROUP BY parent) s
       WHERE b.id = s.parent`,
      [depth],
    )
  }
}

/** Builds `version` of the kind's path model from the current relationship rows; returns the node count. */
async function buildVersion(tx: Tx, kind: Kind, version: string): Promise<number> {
  await tx.query('SELECT gen_analyze_genealogy()')
  await tx.query('SET LOCAL enable_hashjoin = off; SET LOCAL enable_mergejoin = off')
  await tx.query(`CREATE TEMP TABLE gen_path_build (id uuid PRIMARY KEY, parent uuid, path ltree NOT NULL, depth int NOT NULL,
    descendants int NOT NULL DEFAULT 0) ON COMMIT DROP`)
  await tx.query(BUILD_SQL, [kind])
  await tx.query('CREATE INDEX ON gen_path_build (depth); ANALYZE gen_path_build')
  await countDescendants(tx)
  const inserted = await tx.query(
    `INSERT INTO path_node (tenant_id, kind, model_version, position_id, parent_position_id, path, depth, subtree_count)
     SELECT app_tenant_id(), $1, $2, id, parent, path, depth, descendants FROM gen_path_build`,
    [kind, version],
  )
  const nodes = inserted.rowCount ?? 0
  // C-B2-15: every position is a node (terminated ones stay in the tree).
  const { rows } = await tx.query<{ positions: number }>('SELECT count(*)::int AS positions FROM position')
  if (rows[0]!.positions !== nodes) {
    throw new BuildRefused('COUNT_MISMATCH', `the ${kind} build has ${nodes} nodes for ${rows[0]!.positions} positions`)
  }
  return nodes
}

/**
 * One (tenant, kind) rebuild in the tenant's transaction (D-B2-07): version + 1 is built, the model switches to it and
 * the versions before the previous one go. The stale mark clears only if path_model was not written since it was read (its row version, xmin):
 * every relationship write upserts that row, so a write during the build keeps the model stale for the next run.
 */
export async function rebuildModel(tx: Tx, kind: Kind): Promise<RebuildOutcome> {
  const { rows: locked } = await tx.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_xact_lock(hashtextextended('genealogy-rebuild:' || app_tenant_id() || ':' || $1, 0)) AS locked`,
    [kind],
  )
  if (locked[0]?.locked !== true) return { kind, result: 'skipped' }
  const { rows } = await tx.query<{ version: string; row_version: string }>(
    'SELECT version::text AS version, xmin::text AS row_version FROM path_model WHERE kind = $1 AND stale_since IS NOT NULL',
    [kind],
  )
  const model = rows[0]
  if (model === undefined) return { kind, result: 'skipped' }
  const version = (BigInt(model.version) + 1n).toString()
  const nodes = await buildVersion(tx, kind, version)
  const { rows: switched } = await tx.query<{ still_stale: boolean }>(
    `UPDATE path_model SET version = $2, built_at = now(),
       stale_since = CASE WHEN xmin::text = $3 THEN NULL ELSE stale_since END
     WHERE kind = $1 RETURNING stale_since IS NOT NULL AS still_stale`,
    [kind, version, model.row_version],
  )
  // The previous version stays one more cycle: a reader that read it before this commit (READ COMMITTED) still finds its
  // nodes. shortcut: a read spanning two switches (two builds) loses them; read in one snapshot if builds get that fast.
  await tx.query('DELETE FROM path_node WHERE kind = $1 AND model_version < $2::bigint - 1', [kind, version])
  const stillStale = switched[0]!.still_stale
  await recordAudit(tx, {
    action: 'GENEALOGY.REBUILT', objectType: 'path_model', after: { kind, version, nodes, still_stale: stillStale },
  })
  return { kind, result: 'rebuilt', version, nodes, stillStale }
}

const SYSTEM_ACTOR = { actorType: 'system' as const, requestId: null, supportSessionId: null }

/** Every stale model, one tenant transaction each; a failed build is audited and retried on the next run. */
export async function rebuildStaleModels(ctx: JobContext): Promise<RebuildOutcome[]> {
  const { rows } = await withSystem((tx) => tx.query<StaleModel>('SELECT tenant_id, kind FROM gen_stale_models()'))
  const outcomes: RebuildOutcome[] = []
  for (const model of rows) {
    const tenant = { tenantId: model.tenant_id, userId: SYSTEM_ACTOR_ID }
    try {
      outcomes.push(await runInTenant(tenant, SYSTEM_ACTOR, (tx) => rebuildModel(tx, model.kind)))
    } catch (error) {
      ctx.log.error({ err: error, tenantId: model.tenant_id, kind: model.kind }, 'genealogy path rebuild failed')
      const code = String((error as { code?: unknown }).code ?? 'BUILD_FAILED')
      try {
        await runInTenant(tenant, SYSTEM_ACTOR, (tx) =>
          recordAudit(tx, { action: 'GENEALOGY.REBUILD_FAILED', objectType: 'path_model', after: { kind: model.kind, code } }))
      } catch (auditError) {
        // The model stays stale and is retried next run; the other models of this run still build.
        ctx.log.error({ err: auditError, tenantId: model.tenant_id, kind: model.kind, code }, 'genealogy rebuild failure audit failed')
      }
    }
  }
  return outcomes
}

/** System job, every minute (PLAN B2 2.5). */
export const pathsRebuildJob: SystemJob = defineSystemJob({
  name: REBUILD_JOB_NAME,
  cron: '* * * * *',
  async run(ctx) {
    await rebuildStaleModels(ctx)
  },
})
