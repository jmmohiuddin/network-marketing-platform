// Migration loading with the D-B6-14 market scope (outside it: 404), the plan version in force at the cutover period, and
// the SQL refusals MIG maps to API errors.
import type { Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope, scopeOfAny } from '../../lib/auth.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { parse } from '../../lib/http.js'
import type { Permission } from '../../lib/permissions.js'

export const READERS: readonly Permission[] = ['migration.manage', 'migration.signoff']

export type MigrationState = 'draft' | 'applied' | 'opening_submitted' | 'opening_posted' | 'signed_off' | 'cancelled'

export interface MigrationRow {
  readonly id: string
  readonly market_id: string
  readonly import_batch_id: string
  readonly cutover_period_id: string
  readonly volume_key: string
  readonly state: MigrationState
  readonly opening_submitted_by: string | null
  readonly created_by: string
}

const idParams = z.object({ id: z.uuid() })

/** Scope of a write by `permission`, or of a read by any reader permission (null = all markets). */
export const writeScope = (request: FastifyRequest, permission: Permission): readonly string[] | null => marketScope(currentAuth(request), permission)
export const readScope = (request: FastifyRequest): readonly string[] | null => scopeOfAny(currentAuth(request), READERS)

/** The migration of the route's :id in scope, locked for a transition when `lock`; 404 otherwise. */
export async function loadMigration(tx: Tx, request: FastifyRequest, scope: readonly string[] | null, lock = false): Promise<MigrationRow> {
  const { id } = parse(idParams.passthrough(), request.params)
  const { rows } = await tx.query<MigrationRow>(
    `SELECT id, market_id, import_batch_id, cutover_period_id, volume_key, state, opening_submitted_by, created_by
     FROM migration WHERE id = $1 AND ($2::uuid[] IS NULL OR market_id = ANY ($2::uuid[]))${lock ? ' FOR UPDATE' : ''}`,
    [id, scope],
  )
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

export function assertState(migration: MigrationRow, ...allowed: MigrationState[]): void {
  if (!allowed.includes(migration.state)) {
    throw new ApiError(409, 'MIGRATION_STATE', `The migration is ${migration.state}; this step needs it ${allowed.join(' or ')}.`, { state: migration.state })
  }
}

/** The parts of a compiled plan version (engine JSON of one calendar) that opening state and bonus maps are checked against. */
export interface CompiledPlan {
  readonly ladders: readonly { readonly key: string; readonly ranks: readonly { readonly key: string }[] }[]
  readonly carries: readonly { readonly key: string }[]
  readonly counters: readonly { readonly key: string }[]
  readonly bonuses: readonly { readonly key: string; readonly kind: string; readonly onceKey?: string }[]
}

export interface PlanAtCutover {
  readonly versionId: string
  readonly plan: CompiledPlan
}

/**
 * D-B6-10: the plan version in force at the cutover period C, which must start at C (C is a chain start). `required`:
 * none in force → 422 PLAN_REQUIRED; otherwise null is returned (creating a migration needs no plan yet).
 */
export async function planAtCutover(tx: Tx, periodId: string, required: boolean): Promise<PlanAtCutover | null> {
  const { rows } = await tx.query<{ id: string; chain_start: boolean; plan: CompiledPlan | null }>(
    // COMP's chain start (snapshot.ts chainInputs): no plan version covers C's previous period.
    `SELECT v.id, v.compiled -> p.calendar_id::text AS plan,
            v.effective_from >= p.starts_at
              AND plan_version_for_period((SELECT q.id FROM period q WHERE q.calendar_id = p.calendar_id AND q.ends_at = p.starts_at)) IS NULL AS chain_start
     FROM period p JOIN plan_version v ON v.id = plan_version_for_period(p.id) WHERE p.id = $1`,
    [periodId],
  )
  const version = rows[0]
  if (version === undefined || version.plan === null) {
    if (required) throw new ApiError(422, 'PLAN_REQUIRED', 'Schedule the plan version that starts at the cutover period first.')
    return null
  }
  if (!version.chain_start) {
    throw new ApiError(422, 'CUTOVER_NOT_CHAIN_START', 'A plan version is in force before the cutover period: the cutover must be the first period of the plan.')
  }
  return { versionId: version.id, plan: version.plan }
}
