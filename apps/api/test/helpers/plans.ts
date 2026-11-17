import { randomUUID } from 'node:crypto'
import { ownerRows } from './users.js'

export interface FixturePlan {
  readonly submitterId: string
  /** Approves the version; another user than the submitter. */
  readonly approverId: string
  readonly creditingEvent: 'paid' | 'fulfilled'
  readonly placementWidth?: number
  readonly effectiveFrom?: string
  readonly rules?: readonly { readonly rule_key: string; readonly kind: string; readonly params: Record<string, unknown> }[]
}

/**
 * FIXTURE (for modules that read plans only through the SQL contracts: GEN, PAR, ORD, TEN): a plan covering the market
 * with one active version (compiled '{}') and its structural rules, written through the owner pool. Returns the version id.
 */
export async function activePlanVersion(tenantId: string, marketId: string, plan: FixturePlan): Promise<string> {
  const versionId = randomUUID()
  await ownerRows(
    `WITH plan_row AS (INSERT INTO plan (tenant_id, name, created_by) VALUES ($1, $3, $4) RETURNING id),
          covered AS (INSERT INTO plan_market (tenant_id, plan_id, market_id) SELECT $1, id, $2 FROM plan_row),
          approved AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at)
                       VALUES ($1, 'plan_version', $6, $4, $5, 'approved', now()) RETURNING id)
     INSERT INTO plan_version (id, tenant_id, plan_id, version, state, effective_from, justification, engine_version, crediting_event,
       placement_width, compiled, content_hash, submitted_by, submitted_at, approval_id, activation_approval_id, activated_at, created_by)
     SELECT $6, $1, plan_row.id, 1, 'active', $7, 'fixture', 'fixture', $8, $9, '{}', digest('{}'::jsonb::text, 'sha256'), $4, now(),
       approved.id, approved.id, now(), $4
     FROM plan_row, approved`,
    [tenantId, marketId, `fixture-${versionId}`, plan.submitterId, plan.approverId, versionId, plan.effectiveFrom ?? '2000-01-01T00:00:00Z',
      plan.creditingEvent, plan.placementWidth ?? null],
  )
  await ownerRows(
    `INSERT INTO plan_rule (tenant_id, plan_version_id, rule_key, kind, pass, params, created_by, updated_by)
     SELECT $1, $2, r->>'rule_key', r->>'kind', 'structure', r->'params', $3, $3 FROM jsonb_array_elements($4::jsonb) r`,
    [tenantId, versionId, plan.submitterId, JSON.stringify(plan.rules ?? [])],
  )
  return versionId
}
