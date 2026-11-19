// Plan and version loading with the D-B3-23 market scope (a plan object needs the permission over EVERY plan market),
// draft and If-Match checks shared by the PLN routes.
import type { Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope } from '../../lib/auth.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { parse } from '../../lib/http.js'
import type { StoredResponse } from '../../lib/idempotency.js'
import type { Permission } from '../../lib/permissions.js'
import { PLAN_IN_SCOPE } from '../cpl/index.js'

export interface PlanRow {
  readonly id: string
  readonly name: string
  readonly brand_id: string | null
  readonly created_by: string
  readonly created_at: Date
  readonly market_ids: string[]
  readonly minor_digits: number | null // of the first plan market (market id order): rule renderings use it
  readonly calendar_ids: string[]
}

export interface VersionRow {
  readonly id: string
  readonly plan_id: string
  readonly version: number
  readonly state: 'draft' | 'in_review' | 'approved' | 'scheduled' | 'active' | 'retired'
  readonly revision: number
  readonly effective_from: Date | null
  readonly justification: string | null
  readonly engine_version: string
  readonly crediting_event: 'paid' | 'fulfilled' | null
  readonly placement_width: number | null
  readonly content_hash: string | null
  readonly compiled_ok: boolean
  readonly based_on_version_id: string | null
  readonly submitted_by: string | null
  readonly submitted_at: Date | null
  readonly approval_id: string | null
  readonly approved_by: string | null
  readonly activation_approval_id: string | null
  readonly activated_by: string | null
  readonly activated_at: Date | null
  readonly retired_at: Date | null
  readonly created_by: string
  readonly created_at: Date
}

export const PLAN_COLUMNS = `p.id, p.name, p.brand_id, p.created_by, p.created_at,
  array(SELECT pm.market_id FROM plan_market pm WHERE pm.plan_id = p.id ORDER BY pm.market_id) AS market_ids,
  (SELECT m.minor_unit::int FROM plan_market pm JOIN market m ON m.tenant_id = pm.tenant_id AND m.id = pm.market_id
   WHERE pm.plan_id = p.id ORDER BY pm.market_id LIMIT 1) AS minor_digits,
  array(SELECT pc.calendar_id FROM plan_calendar pc WHERE pc.plan_id = p.id ORDER BY pc.calendar_id) AS calendar_ids`

export const VERSION_COLUMNS = `v.id, v.plan_id, v.version, v.state, v.revision, v.effective_from, v.justification, v.engine_version,
  v.crediting_event, v.placement_width, encode(v.content_hash, 'hex') AS content_hash, v.compiled IS NOT NULL AS compiled_ok,
  v.based_on_version_id, v.submitted_by, v.submitted_at, v.approval_id,
  (SELECT a.approver_id FROM approval a WHERE a.id = v.approval_id) AS approved_by, v.activation_approval_id,
  (SELECT a.approver_id FROM approval a WHERE a.id = v.activation_approval_id) AS activated_by, v.activated_at, v.retired_at,
  v.created_by, v.created_at`

export const planParams = z.strictObject({ id: z.uuid() })
export const versionParams = z.strictObject({ id: z.uuid(), v: z.coerce.number().int().min(1).max(1_000_000) })

/** The plan, or 404 when it does not exist or a plan market is outside the caller's scope of `permission`. */
export async function loadPlan(tx: Tx, request: FastifyRequest, planId: string, permission: Permission): Promise<PlanRow> {
  const scope = marketScope(currentAuth(request), permission)
  const { rows } = await tx.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plan p WHERE p.id = $1 AND ${PLAN_IN_SCOPE('p.id', '$2')}`, [planId, scope])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

export async function loadVersion(tx: Tx, planId: string, version: number, lock = false): Promise<VersionRow> {
  if (lock) await tx.query('SELECT 1 FROM plan_version WHERE plan_id = $1 AND version = $2 FOR UPDATE', [planId, version])
  const { rows } = await tx.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM plan_version v WHERE v.plan_id = $1 AND v.version = $2`, [planId, version])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

/** Plan + version (locked) for a write by `permission`, from the route params. */
export async function planVersionFor(tx: Tx, request: FastifyRequest, permission: Permission, lock = true): Promise<{ plan: PlanRow; version: VersionRow }> {
  const params = parse(versionParams.passthrough(), request.params)
  const plan = await loadPlan(tx, request, params.id, permission)
  return { plan, version: await loadVersion(tx, plan.id, params.v, lock) }
}

export function assertDraft(version: VersionRow): void {
  if (version.state !== 'draft') throw new ApiError(409, 'VERSION_NOT_DRAFT', 'Only a draft version can be changed; create a new version.')
}

/** If-Match revision of a draft write: 428 when missing, 412 when stale (AC-PLN1-1). Read before any lock. */
export function ifMatch(request: FastifyRequest): number {
  const header = request.headers['if-match']
  if (header === undefined) throw new ApiError(428, 'PRECONDITION_REQUIRED', 'Send If-Match with the version revision you saw (its ETag).')
  const match = /^"?(\d{1,9})"?$/.exec(String(header).trim())
  if (match === null) throw new ApiError(400, 'VALIDATION_FAILED', 'If-Match must be a revision number.')
  return Number(match[1])
}

export function assertRevision(version: VersionRow, expected: number): void {
  assertDraft(version)
  if (version.revision !== expected) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'The version changed since you loaded it. Reload and try again.', { revision: version.revision })
  }
}

export const etag = (revision: number): string => `"${revision}"`

/** A refusal stored as the request's response (it commits with what the request wrote, B2 stored-response pattern). */
export function storedError(request: FastifyRequest, statusCode: number, code: string, message: string, details: unknown): StoredResponse {
  return { statusCode, body: { error: { code, message, details, request_id: request.id } } }
}

/** SQLSTATE of a database error (or undefined). */
export const sqlState = (error: unknown): string | undefined => (typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined)
