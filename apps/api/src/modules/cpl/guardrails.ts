// Guardrail decisions over plan versions (PLAN B3 D-B3-17, FR-CPL-007/008): evaluation rows (insert-only, one per
// version, guardrail rule and matched content), acknowledgements and the reads PLN and the decision routes share.
import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { evaluatePredicate, type GuardrailRuleRow } from './guardrail-checks.js'

export interface Evaluation {
  readonly id: string
  readonly rule_id: string
  readonly title: string
  readonly basis_status: string
  readonly overridable: boolean
  readonly outcome: 'blocked' | 'warned' | 'reported'
  readonly detail: { readonly rule_keys: readonly string[]; readonly explanation: string; readonly opaque: boolean }
  readonly content_sha256: Buffer
  /** Inserted by this evaluation (false: the same content was evaluated before). */
  readonly created: boolean
}

interface GuardrailRule { readonly id: string; readonly title: string; readonly outcome: Evaluation['outcome']; readonly predicate: unknown; readonly overridable: boolean; readonly basis_status: string }

/** Plan markets in scope: every market of the plan (D-B3-23); null scope = all markets. */
export const PLAN_IN_SCOPE = (plan: string, scopeParam: string): string =>
  `(${scopeParam}::uuid[] IS NULL OR NOT EXISTS (SELECT 1 FROM plan_market pm WHERE pm.plan_id = ${plan} AND pm.market_id <> ALL (${scopeParam}::uuid[])))`

/**
 * Evaluates the guardrail rules in force today for the market packs of the version's plan markets against its rule rows
 * and stores each matched content once (dedupe index); audit GUARDRAIL.EVALUATED per new row. Returns every current
 * match, new or already stored.
 */
export async function evaluateGuardrails(tx: Tx, versionId: string): Promise<Evaluation[]> {
  const { rows: rules } = await tx.query<GuardrailRuleRow>(
    'SELECT rule_key, kind, params, depends_on FROM plan_rule WHERE plan_version_id = $1 ORDER BY rule_key', [versionId],
  )
  const { rows: guardrails } = await tx.query<GuardrailRule>(
    `SELECT g.id, g.title, g.outcome, g.predicate, g.overridable, g.basis_status FROM guardrail_rule g
     WHERE g.market_pack IN (SELECT m.market_pack FROM plan_version v
                             JOIN plan_market pm ON pm.tenant_id = v.tenant_id AND pm.plan_id = v.plan_id
                             JOIN market m ON m.tenant_id = pm.tenant_id AND m.id = pm.market_id WHERE v.id = $1)
       AND g.effective_from <= current_date AND (g.effective_to IS NULL OR g.effective_to > current_date)
     ORDER BY g.id`,
    [versionId],
  )
  const out: Evaluation[] = []
  for (const g of guardrails) {
    for (const match of evaluatePredicate(g.predicate, rules)) {
      // An opaque match of a blocking rule stays blocked and goes to compliance review (D-B4-21 b); any other opaque match warns.
      const outcome = match.opaque && g.outcome !== 'blocked' ? 'warned' : g.outcome
      const detail = { rule_keys: match.ruleKeys, explanation: match.explanation, opaque: match.opaque }
      out.push(await storeEvaluation(tx, versionId, g, outcome, detail))
    }
  }
  return out
}

async function storeEvaluation(tx: Tx, versionId: string, g: GuardrailRule, outcome: Evaluation['outcome'], detail: Evaluation['detail']): Promise<Evaluation> {
  type Stored = { id: string; content_sha256: Buffer; outcome: Evaluation['outcome'] }
  const inserted = await tx.query<Stored>(
    `INSERT INTO guardrail_decision (tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail)
     VALUES (app_tenant_id(), $1, $2, 'evaluation', $3, guardrail_rules_hash($2, $4::text[]), $5)
     ON CONFLICT (plan_version_id, rule_id, content_sha256, md5(detail::text)) WHERE kind = 'evaluation' DO NOTHING
     RETURNING id, content_sha256, outcome`,
    [g.id, versionId, outcome, detail.rule_keys, detail],
  )
  // The dedupe key has no outcome: an evaluation stored before a guardrail rule's outcome changed stays the stored one.
  const row = inserted.rows[0] ?? (await tx.query<Stored>(
    `SELECT id, content_sha256, outcome FROM guardrail_decision
     WHERE kind = 'evaluation' AND rule_id = $1 AND plan_version_id = $2 AND content_sha256 = guardrail_rules_hash($2, $3::text[]) AND detail = $4`,
    [g.id, versionId, detail.rule_keys, detail],
  )).rows[0]!
  if (inserted.rows[0] !== undefined) {
    await recordAudit(tx, { action: 'GUARDRAIL.EVALUATED', objectType: 'guardrail_decision', objectId: row.id, after: { plan_version_id: versionId, rule_id: g.id, outcome, rule_keys: detail.rule_keys } })
  }
  return { id: row.id, rule_id: g.id, title: g.title, basis_status: g.basis_status, overridable: g.overridable, outcome: row.outcome, detail, content_sha256: row.content_sha256, created: inserted.rows[0] !== undefined }
}

/**
 * Stores evaluations again after their transaction part was rolled back (a refused rule save, D-B3-17: the decision
 * row still commits). content_sha256 is the hash of the refused content, which no longer exists.
 */
export async function restoreEvaluations(tx: Tx, versionId: string, evaluations: readonly Evaluation[]): Promise<void> {
  for (const e of evaluations.filter((x) => x.created)) {
    await tx.query(
      `INSERT INTO guardrail_decision (id, tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail)
       VALUES ($1, app_tenant_id(), $2, $3, 'evaluation', $4, $5, $6)`,
      [e.id, e.rule_id, versionId, e.outcome, e.content_sha256, e.detail],
    )
    await recordAudit(tx, { action: 'GUARDRAIL.EVALUATED', objectType: 'guardrail_decision', objectId: e.id, after: { plan_version_id: versionId, rule_id: e.rule_id, outcome: e.outcome, rule_keys: e.detail.rule_keys, refused_save: true } })
  }
}

export interface Outstanding { readonly decision_id: string; readonly rule_id: string; readonly outcome: string; readonly reason: string }

/** Current evaluations still needing an acknowledgement or override (submit gate, GUARDRAIL_OUTSTANDING). */
export async function outstandingDecisions(tx: Tx, versionId: string): Promise<Outstanding[]> {
  const { rows } = await tx.query<Outstanding>('SELECT decision_id, rule_id, outcome, reason FROM guardrail_outstanding($1)', [versionId])
  return rows
}

/**
 * D-B4-21 b: an opaque evaluation goes to compliance review when it or its rule (now) is blocked — the rule covers an
 * opaque match of a blocking rule stored as warned before B4 (0411 mirrors it). SQL over `d` and `g`.
 */
export const COMPLIANCE_REVIEW = `((d.detail ->> 'opaque') IS NOT DISTINCT FROM 'true' AND 'blocked' IN (d.outcome, g.outcome))`

/** plan.edit acknowledges a warned evaluation of the version (FR-CPL-007; 409 COMPLIANCE_REVIEW_REQUIRED / NOT_WARNED / ALREADY_ACKNOWLEDGED). */
export async function acknowledgeDecision(tx: Tx, versionId: string, decisionId: string): Promise<Record<string, unknown>> {
  const { rows } = await tx.query<{ outcome: string; review: boolean; acknowledged: boolean }>(
    `SELECT d.outcome, ${COMPLIANCE_REVIEW} AS review, EXISTS (SELECT 1 FROM guardrail_decision a WHERE a.refers_to_decision_id = d.id AND a.kind = 'acknowledgement') AS acknowledged
     FROM guardrail_decision d JOIN guardrail_rule g ON g.id = d.rule_id WHERE d.id = $1 AND d.plan_version_id = $2 AND d.kind = 'evaluation'`,
    [decisionId, versionId],
  )
  const evaluation = rows[0]
  if (evaluation === undefined) throw notFound()
  if (evaluation.review) {
    throw new ApiError(409, 'COMPLIANCE_REVIEW_REQUIRED', 'The platform cannot check this rule: a compliance officer must review and override it.')
  }
  if (evaluation.outcome !== 'warned') throw new ApiError(409, 'NOT_WARNED', 'Only a warning is acknowledged; a blocked rule needs an override.')
  if (evaluation.acknowledged) throw new ApiError(409, 'ALREADY_ACKNOWLEDGED', 'This warning is already acknowledged.')
  // One acknowledgement per evaluation: the unique index decides a concurrent second one (rows are insert-only, no lock).
  const { rows: created } = await tx.query<{ id: string }>(
    `INSERT INTO guardrail_decision (tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail, refers_to_decision_id)
     SELECT tenant_id, rule_id, plan_version_id, 'acknowledgement', outcome, content_sha256, detail, id FROM guardrail_decision WHERE id = $1
     RETURNING id`,
    [decisionId],
  ).catch((error: { code?: string }) => {
    if (error.code === '23505') throw new ApiError(409, 'ALREADY_ACKNOWLEDGED', 'This warning is already acknowledged.')
    throw error
  })
  const id = created[0]!.id
  await recordAudit(tx, { action: 'GUARDRAIL.ACKNOWLEDGED', objectType: 'guardrail_decision', objectId: id, after: { refers_to_decision_id: decisionId, plan_version_id: versionId } })
  return (await decisionViews(tx, { ids: [id] }))[0]!
}

const ACTOR = (alias: string): string => `jsonb_build_object('id', ${alias}.id, 'display_name', ${alias}.display_name)`

/** The decision view of SC-11 and the version page (snake_case, ids only beyond display names). */
export const DECISION_VIEW = `
  SELECT d.id, d.kind, d.outcome, d.detail, d.decided_at, d.refers_to_decision_id, d.plan_version_id,
         jsonb_build_object('id', g.id, 'title', g.title, 'outcome', g.outcome, 'overridable', g.overridable, 'mandatory', g.mandatory,
                            'basis', g.basis, 'basis_status', g.basis_status, 'source_ref', g.source_ref, 'market_pack', g.market_pack) AS rule,
         jsonb_build_object('id', p.id, 'name', p.name) AS plan,
         jsonb_build_object('id', v.id, 'version', v.version, 'state', v.state) AS version,
         ${ACTOR('u')} AS decided_by,
         (SELECT jsonb_build_object('id', a.id, 'decided_by', ${ACTOR('au')}, 'decided_at', a.decided_at)
          FROM guardrail_decision a JOIN user_account au ON au.id = a.decided_by
          WHERE d.kind = 'evaluation' AND a.refers_to_decision_id = d.id AND a.kind = 'acknowledgement') AS acknowledgement,
         (SELECT jsonb_build_object('id', o.id, 'justification', o.justification, 'approved_by', ${ACTOR('ou')},
                                    'evidence_document_id', o.evidence_document_id, 'decided_at', o.decided_at)
          FROM guardrail_decision o JOIN user_account ou ON ou.id = o.decided_by
          WHERE d.kind = 'evaluation' AND o.refers_to_decision_id = d.id AND o.kind = 'override') AS override
  FROM guardrail_decision d
  JOIN guardrail_rule g ON g.id = d.rule_id
  JOIN plan_version v ON v.tenant_id = d.tenant_id AND v.id = d.plan_version_id
  JOIN plan p ON p.tenant_id = v.tenant_id AND p.id = v.plan_id
  JOIN user_account u ON u.id = d.decided_by`

/** Decisions by id, in the given order (no scope check: callers check the plan first). */
export async function decisionViews(tx: Tx, q: { readonly ids: readonly string[] }): Promise<Record<string, unknown>[]> {
  const { rows } = await tx.query<Record<string, unknown>>(`${DECISION_VIEW} WHERE d.id = ANY ($1::uuid[]) ORDER BY array_position($1::uuid[], d.id)`, [q.ids])
  return rows
}

/** The latest evaluation per guardrail rule of the version, with its acknowledgement and override (version page). */
export async function latestDecisions(tx: Tx, versionId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await tx.query<Record<string, unknown>>(
    `SELECT * FROM (${DECISION_VIEW} WHERE d.plan_version_id = $1 AND d.kind = 'evaluation') AS x
     WHERE x.id IN (SELECT DISTINCT ON (rule_id, detail -> 'rule_keys') id FROM guardrail_decision
                    WHERE plan_version_id = $1 AND kind = 'evaluation' ORDER BY rule_id, detail -> 'rule_keys', decided_at DESC, id)
     ORDER BY x.decided_at, x.id`,
    [versionId],
  )
  return rows
}
