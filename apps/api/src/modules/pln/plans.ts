// Plans and versions (API-16 part): list, create (version 1 draft), read, new authoring version.
import { ENGINE_VERSION } from '@nmp/engine'
import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { evaluateGuardrails, PLAN_IN_SCOPE } from '../cpl/index.js'
import { getSetting } from '../ten/index.js'
import { loadPlan, loadVersion, planParams, sqlState, VERSION_COLUMNS, type VersionRow } from './access.js'
import { recompile } from './content.js'
import { versionFields } from './views.js'

const ids = z.array(z.uuid()).min(1).max(20).refine((list) => new Set(list).size === list.length, 'ids must be distinct')
const createBody = z.strictObject({ name: z.string().trim().min(1).max(100), brand_id: z.uuid().optional(), market_ids: ids, calendar_ids: ids })
const listQuery = z.strictObject({ market_id: z.uuid().optional(), ...pageQuery })
const newVersionBody = z.strictObject({ based_on_version_id: z.uuid().optional() })
const cursorSchema = z.tuple([z.string(), z.uuid()])

const PLAN_VIEW = `
  SELECT p.id, p.name, p.created_at,
    (SELECT jsonb_build_object('id', b.id, 'name', b.name) FROM brand b WHERE b.tenant_id = p.tenant_id AND b.id = p.brand_id) AS brand,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code) ORDER BY m.code), '[]')
     FROM plan_market pm JOIN market m ON m.tenant_id = pm.tenant_id AND m.id = pm.market_id WHERE pm.plan_id = p.id) AS markets,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'cadence', c.cadence, 'market_code', m.code) ORDER BY c.name, c.id), '[]')
     FROM plan_calendar pc JOIN calendar c ON c.tenant_id = pc.tenant_id AND c.id = pc.calendar_id
     JOIN market m ON m.tenant_id = c.tenant_id AND m.id = c.market_id WHERE pc.plan_id = p.id) AS calendars,
    (SELECT jsonb_build_object('id', v.id, 'version', v.version, 'state', v.state, 'effective_from', v.effective_from)
     FROM plan_version v WHERE v.plan_id = p.id AND v.state = 'active') AS current_version,
    (SELECT jsonb_build_object('id', v.id, 'version', v.version, 'state', v.state)
     FROM plan_version v WHERE v.plan_id = p.id AND v.state IN ('draft', 'in_review')) AS authoring_version
  FROM plan p`

async function planView(tx: Tx, planId: string): Promise<Record<string, unknown>> {
  const { rows } = await tx.query<Record<string, unknown>>(`${PLAN_VIEW} WHERE p.id = $1`, [planId])
  return rows[0]!
}

async function versionsOf(tx: Tx, planId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await tx.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM plan_version v WHERE v.plan_id = $1 ORDER BY v.version DESC`, [planId])
  return rows.map((v) => ({ id: v.id, version: v.version, state: v.state, effective_from: v.effective_from, submitted_by: v.submitted_by, approved_by: v.approved_by, activated_by: v.activated_by, created_at: v.created_at }))
}

/** POST /v1/plans checks: markets and calendars exist, every calendar is in a named market and in no other plan. */
async function checkStructure(tx: Tx, body: z.infer<typeof createBody>): Promise<void> {
  const { rows: markets } = await tx.query<{ id: string }>('SELECT id FROM market WHERE id = ANY ($1::uuid[])', [body.market_ids])
  if (markets.length !== body.market_ids.length) throw new ApiError(422, 'MARKET_UNKNOWN', 'A market of the plan does not exist.')
  const { rows: calendars } = await tx.query<{ id: string; market_id: string; planned: boolean }>(
    `SELECT c.id, c.market_id, EXISTS (SELECT 1 FROM plan_calendar pc WHERE pc.calendar_id = c.id) AS planned
     FROM calendar c WHERE c.id = ANY ($1::uuid[])`,
    [body.calendar_ids],
  )
  const mismatched = body.calendar_ids.filter((id) => !calendars.some((c) => c.id === id && body.market_ids.includes(c.market_id)))
  if (mismatched.length > 0) throw new ApiError(422, 'CALENDAR_MARKET_MISMATCH', 'Every calendar must be a calendar of one of the plan markets.', { calendar_ids: mismatched })
  const planned = calendars.filter((c) => c.planned).map((c) => c.id)
  if (planned.length > 0) throw new ApiError(409, 'CALENDAR_IN_PLAN', 'A calendar belongs to at most one plan.', { calendar_ids: planned })
}

export function registerPlanRoutes(app: FastifyInstance): void {
  app.get('/v1/plans', { preHandler: [requireRealm('tenant'), requirePermission('plan.read')] }, async (request) => {
    const q = parse(listQuery, request.query)
    const scope = marketScope(currentAuth(request), 'plan.read')
    const after = decodeCursor(q.cursor, cursorSchema)
    return inTenant(request, async (tx) => {
      const { rows } = await tx.query<{ id: string; name: string }>(
        `${PLAN_VIEW} WHERE ${PLAN_IN_SCOPE('p.id', '$1')}
           AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM plan_market pm WHERE pm.plan_id = p.id AND pm.market_id = $2))
           AND ($3::text IS NULL OR (p.name, p.id) > ($3::text, $4::uuid))
         ORDER BY p.name, p.id LIMIT $5`,
        [scope, q.market_id ?? null, after?.[0] ?? null, after?.[1] ?? null, q.limit + 1],
      )
      return toPage(rows, q.limit, (row) => [row.name, row.id])
    })
  })

  app.post('/v1/plans', { preHandler: [requireRealm('tenant'), requirePermission('plan.edit')] }, async (request, reply) => {
    const body = parse(createBody, request.body)
    const scope = marketScope(currentAuth(request), 'plan.edit')
    if (scope !== null && body.market_ids.some((id) => !scope.includes(id))) {
      throw new ApiError(403, 'SCOPE_NOT_HELD', 'Creating this plan needs plan.edit over every market it names.', { permission: 'plan.edit' })
    }
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      await checkStructure(tx, body)
      const { rows } = await tx.query<{ id: string }>(
        'INSERT INTO plan (tenant_id, name, brand_id, created_by) VALUES (app_tenant_id(), $1, $2, app_user_id()) RETURNING id',
        [body.name, body.brand_id ?? null],
      ).catch((error: unknown) => {
        if (sqlState(error) === '23505') throw new ApiError(409, 'PLAN_NAME_TAKEN', 'A plan with this name exists.')
        if (sqlState(error) === '23503') throw new ApiError(422, 'BRAND_NOT_FOUND', 'The brand does not exist.')
        throw error
      })
      const planId = rows[0]!.id
      await tx.query('INSERT INTO plan_market (tenant_id, plan_id, market_id) SELECT app_tenant_id(), $1, unnest($2::uuid[])', [planId, body.market_ids])
      await tx.query('INSERT INTO plan_calendar (tenant_id, plan_id, calendar_id) SELECT app_tenant_id(), $1, unnest($2::uuid[])', [planId, body.calendar_ids])
        .catch((error: unknown) => {
          if (sqlState(error) === '23505') throw new ApiError(409, 'CALENDAR_IN_PLAN', 'A calendar belongs to at most one plan.')
          throw error
        })
      // D-B3-06: the tenant's own legacy width (not a shipped default) pre-fills the first draft.
      const width = await getSetting(tx, 'genealogy.placement_width')
      const { rows: versions } = await tx.query<{ id: string }>(
        `INSERT INTO plan_version (tenant_id, plan_id, version, engine_version, placement_width, created_by)
         VALUES (app_tenant_id(), $1, 1, $2, $3, app_user_id()) RETURNING id`,
        [planId, ENGINE_VERSION, width],
      )
      await recordAudit(tx, { action: 'PLAN.CREATED', objectType: 'plan', objectId: planId, after: { name: body.name, market_ids: body.market_ids, calendar_ids: body.calendar_ids } })
      await recordAudit(tx, { action: 'PLAN_VERSION.CREATED', objectType: 'plan_version', objectId: versions[0]!.id, after: { plan_id: planId, version: 1, placement_width: width } })
      return { statusCode: 201, body: envelope({ plan: await planView(tx, planId), version: versionFields(await loadVersion(tx, planId, 1)) }) }
    }))
    return sendIdempotent(reply, result)
  })

  app.get('/v1/plans/:id', { preHandler: [requireRealm('tenant'), requirePermission('plan.read')] }, async (request) => {
    const { id } = parse(planParams, request.params)
    return inTenant(request, async (tx) => {
      const plan = await loadPlan(tx, request, id, 'plan.read')
      return envelope({ ...(await planView(tx, plan.id)), versions: await versionsOf(tx, plan.id) })
    })
  })

  // A new authoring version copies the rules and transitions of the version it is based on (goldens are not copied).
  app.post('/v1/plans/:id/versions', { preHandler: [requireRealm('tenant'), requirePermission('plan.edit')] }, async (request, reply) => {
    const { id } = parse(planParams, request.params)
    const body = parse(newVersionBody, request.body ?? {})
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const plan = await loadPlan(tx, request, id, 'plan.edit')
      await tx.query('SELECT 1 FROM plan WHERE id = $1 FOR UPDATE', [plan.id])
      const { rows: authoring } = await tx.query("SELECT 1 FROM plan_version WHERE plan_id = $1 AND state IN ('draft', 'in_review')", [plan.id])
      if (authoring.length > 0) throw new ApiError(409, 'VERSION_IN_AUTHORING', 'This plan already has a draft or a version in review.')
      const { rows: bases } = await tx.query<{ id: string; next: number; crediting_event: string | null; placement_width: number | null }>(
        `SELECT b.id, (SELECT max(version) + 1 FROM plan_version WHERE plan_id = $1) AS next, b.crediting_event, b.placement_width
         FROM plan_version b WHERE b.plan_id = $1 AND ($2::uuid IS NULL OR b.id = $2) ORDER BY b.version DESC LIMIT 1`,
        [plan.id, body.based_on_version_id ?? null],
      )
      const base = bases[0]
      if (base === undefined) throw new ApiError(422, 'VERSION_NOT_FOUND', 'based_on_version_id is not a version of this plan.')
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO plan_version (tenant_id, plan_id, version, engine_version, crediting_event, placement_width, based_on_version_id, created_by)
         VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, app_user_id()) RETURNING id`,
        [plan.id, base.next, ENGINE_VERSION, base.crediting_event, base.placement_width, base.id],
      )
      const versionId = rows[0]!.id
      await tx.query(
        `INSERT INTO plan_rule (tenant_id, plan_version_id, rule_key, kind, pass, params, depends_on, reversal_policy, calendar_id, ordinal, created_by, updated_by)
         SELECT tenant_id, $2, rule_key, kind, pass, params, depends_on, reversal_policy, calendar_id, ordinal, app_user_id(), app_user_id()
         FROM plan_rule WHERE plan_version_id = $1`,
        [base.id, versionId],
      )
      await tx.query(
        `INSERT INTO plan_transition (tenant_id, to_version_id, state_item, rule, map, reason, created_by)
         SELECT tenant_id, $2, state_item, rule, map, reason, app_user_id() FROM plan_transition WHERE to_version_id = $1`,
        [base.id, versionId],
      )
      await recompile(tx, { id: versionId, version: base.next }, plan.calendar_ids)
      await evaluateGuardrails(tx, versionId)
      await recordAudit(tx, { action: 'PLAN_VERSION.CREATED', objectType: 'plan_version', objectId: versionId, after: { plan_id: plan.id, version: base.next, based_on_version_id: base.id } })
      return { statusCode: 201, body: envelope(versionFields(await loadVersion(tx, plan.id, base.next))) }
    }))
    return sendIdempotent(reply, result)
  })
}
