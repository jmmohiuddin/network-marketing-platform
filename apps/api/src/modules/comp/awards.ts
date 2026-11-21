import type { Tx } from '@nmp/db'
import type { CreditAward } from '@nmp/engine'
import { jsonText } from './results.js'
import { runInScope } from './views.js'

// D-V1A-03 (FR-FIN-006): award-rule lines leave the engine as credit awards; COMP writes them as credit_award rows in
// the run-output transaction (tx B, the run still running). The insert trigger copies the type's expiry days, notice
// days, taxable flag and unit value; the commit posts them in the run entry (led_post_run, 0800). No adjustment origin
// is ever made for an award rule (late.ts originsFor).

const BATCH = 5000

export async function insertCreditAwards(tx: Tx, runId: string, marketId: string, awards: readonly CreditAward[]): Promise<void> {
  for (let start = 0; start < awards.length; start += BATCH) {
    const batch = awards.slice(start, start + BATCH)
    await tx.query(
      `INSERT INTO credit_award (tenant_id, run_id, market_id, payee_participant_id, payee_position_id, rule_key, credit_type_id, amount_minor,
         currency, trace)
       SELECT app_tenant_id(), $1, $2, x.participant, x.position, x.rule_key, t.id, x.amount, x.currency, x.trace
       FROM unnest($3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::bigint[], $8::text[], $9::jsonb[])
         AS x(participant, position, rule_key, code, amount, currency, trace)
       JOIN credit_type t ON t.code = x.code`,
      [
        runId, marketId, batch.map((a) => a.payeeParticipantId), batch.map((a) => a.payeePositionId), batch.map((a) => a.ruleKey),
        batch.map((a) => a.creditType), batch.map((a) => a.amountMinor.toString()), batch.map((a) => a.currency), batch.map((a) => jsonText(a.trace)),
      ],
    )
  }
}

/** GET /v1/runs/:id/credit-awards (run.review, market scope): one page of the run's awards and the totals per credit type. */
export async function runCreditAwards(tx: Tx, runId: string, scope: readonly string[] | null, after: string | undefined, limit: number) {
  await runInScope(tx, runId, scope)
  const { rows } = await tx.query(
    `SELECT a.id, jsonb_build_object('id', pa.id, 'external_ref', pa.external_ref) AS participant, x.position_ref, a.rule_key,
            jsonb_build_object('code', t.code, 'name', t.name) AS credit_type, a.amount_minor::text, a.expiry_days, a.taxable
     FROM credit_award a JOIN credit_type t ON t.id = a.credit_type_id JOIN participant pa ON pa.id = a.payee_participant_id
     JOIN position x ON x.id = a.payee_position_id
     WHERE a.run_id = $1 AND ($2::uuid IS NULL OR a.id > $2) ORDER BY a.id LIMIT $3`,
    [runId, after ?? null, limit + 1],
  )
  const { rows: totals } = await tx.query(
    `SELECT jsonb_build_object('code', t.code, 'name', t.name) AS credit_type, sum(a.amount_minor)::text AS amount_minor
     FROM credit_award a JOIN credit_type t ON t.id = a.credit_type_id WHERE a.run_id = $1 GROUP BY t.code, t.name ORDER BY t.code`,
    [runId],
  )
  return { rows: rows as { id: string }[], totals }
}
