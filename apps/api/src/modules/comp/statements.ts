import type { Tx } from '@nmp/db'
import { formatUnits } from '@nmp/engine'
import type { FastifyBaseLogger } from 'fastify'
import { recordAudit } from '../../lib/audit.js'
import { toCsv } from '../../lib/csv.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { explainLine, marketDay, ruleName, traceFromJson } from './explanation.js'

// FR-DIST-001 (D-B5-07): a statement is derived on read from one committed run and the session participant's
// result_line and run_settlement rows; no statement table. Every query also names the participant (the self-scope
// policies of a portal transaction are the backstop).
// shortcut: statements derived per request, add a cached projection when a statement read exceeds 300 ms p95.

export type OriginKind = 'none' | 'late_order' | 'refund' | 'manual' | 'restatement'

export interface StatementLine {
  readonly id: string
  readonly position_id: string
  readonly position_ref: string
  readonly rule_key: string
  readonly amount_minor: string
  readonly origin_type: string | null
  readonly original_period_id: string | null
}

export interface Settlement {
  readonly gross_minor: string
  readonly netted_minor: string
  readonly withheld_minor: string
  readonly net_payable_minor: string
}

export interface LadderRank { readonly ladder: string; readonly rank: string | null }

/** A line's origin as the distributor reads it (late order or refund by the sign of a late or clawback line). */
export function originKind(originType: string | null, amountMinor: bigint): OriginKind {
  if (originType === null) return 'none'
  if (originType === 'manual' || originType === 'restatement') return originType
  return amountMinor < 0n ? 'refund' : 'late_order'
}

const sum = (values: readonly bigint[]): bigint => values.reduce((a, b) => a + b, 0n)

/**
 * The statement body (AC-04.1, AC-04.2): lines per position and bonus with totals, and the summary from the settlement.
 * `invariant` is false when net <> gross - withheld - clawback + adjustment, or the settlement does not pay the lines.
 */
export function buildStatement(
  lines: readonly StatementLine[], settlement: Settlement | null, paidAs: ReadonlyMap<string, readonly LadderRank[]>,
) {
  const positions = [...new Set(lines.map((l) => l.position_id))].map((positionId) => {
    const own = lines.filter((l) => l.position_id === positionId)
    const bonuses = [...new Set(own.map((l) => l.rule_key))].sort().map((ruleKey) => {
      const ofRule = own.filter((l) => l.rule_key === ruleKey)
      return {
        rule_key: ruleKey, rule_name: ruleName(ruleKey), total_minor: sum(ofRule.map((l) => BigInt(l.amount_minor))).toString(),
        lines: ofRule.map((l) => ({
          id: l.id, amount_minor: l.amount_minor, origin_kind: originKind(l.origin_type, BigInt(l.amount_minor)), original_period_id: l.original_period_id,
        })),
      }
    })
    return {
      position_id: positionId, position_ref: own[0]!.position_ref, paid_as: paidAs.get(positionId) ?? [], bonuses,
      total_minor: sum(own.map((l) => BigInt(l.amount_minor))).toString(),
    }
  })
  const gross = sum(lines.filter((l) => l.origin_type === null).map((l) => BigInt(l.amount_minor)))
  const adjustment = sum(lines.filter((l) => l.origin_type !== null).map((l) => BigInt(l.amount_minor)))
  const clawback = BigInt(settlement?.netted_minor ?? '0')
  const withheld = BigInt(settlement?.withheld_minor ?? '0')
  const net = BigInt(settlement?.net_payable_minor ?? '0')
  const invariant = (settlement !== null || lines.length === 0)
    && net === gross - withheld - clawback + adjustment && BigInt(settlement?.gross_minor ?? '0') === gross + adjustment
  return {
    positions, person_total_minor: (gross + adjustment).toString(),
    summary: {
      gross_minor: gross.toString(), adjustment_minor: adjustment.toString(), clawback_minor: clawback.toString(),
      withheld_minor: withheld.toString(), net_minor: net.toString(),
    },
    invariant,
  }
}

/** Payout state of the participant's instructions of the run's period (retried instructions count as their retry). */
const PAYOUT_STATE = `(SELECT CASE WHEN count(*) = 0 THEN 'none' WHEN count(DISTINCT x.s) > 1 THEN 'mixed' ELSE min(x.s) END
  FROM (SELECT CASE WHEN i.state IN ('pending', 'instructed', 'accepted') THEN 'in_transit' WHEN i.state IN ('failed', 'cancelled') THEN 'failed'
                    ELSE i.state END AS s
        FROM payout_instruction i
        WHERE i.payee_participant_id = $1 AND pay_batch_period(i.batch_id) = r.period_id
          AND NOT EXISTS (SELECT 1 FROM payout_instruction n WHERE n.retry_of = i.id)) x)`

const HAS_STATEMENT = `(EXISTS (SELECT 1 FROM run_settlement s WHERE s.run_id = r.id AND s.payee_participant_id = $1)
  OR EXISTS (SELECT 1 FROM result_line l WHERE l.run_id = r.id AND l.payee_participant_id = $1))`

interface StatementRow {
  readonly run_id: string
  readonly period_id: string
  readonly starts_at: Date
  readonly ends_at: Date
  readonly period_state: string
  readonly market_id: string
  readonly code: string
  readonly currency: string
  readonly minor_unit: number
  readonly time_zone: string
  readonly committed_at: Date
}

const RUN_COLUMNS = `r.id AS run_id, p.id AS period_id, p.starts_at, p.ends_at, p.state AS period_state, m.id AS market_id, m.code, m.currency,
  m.minor_unit, m.time_zone, r.committed_at`
const RUN_FROM = `FROM run r JOIN period p ON p.id = r.period_id JOIN calendar c ON c.id = p.calendar_id JOIN market m ON m.id = c.market_id`

const head = (row: StatementRow) => ({
  run_id: row.run_id,
  period: { id: row.period_id, starts_at: row.starts_at, ends_at: row.ends_at, state: row.period_state },
  market: { code: row.code, currency: row.currency, minor_unit: row.minor_unit, time_zone: row.time_zone },
  committed_at: row.committed_at,
})

export interface StatementCursor { readonly starts_at: string; readonly run_id: string }

/** GET /v1/me/statements: committed runs with a statement for the participant, newest period first. */
export async function listStatements(tx: Tx, participantId: string, marketId: string | undefined, after: StatementCursor | undefined, limit: number) {
  const { rows } = await tx.query<StatementRow & { net_minor: string | null; payout_state: string }>(
    `SELECT ${RUN_COLUMNS},
            (SELECT s.net_payable_minor::text FROM run_settlement s WHERE s.run_id = r.id AND s.payee_participant_id = $1) AS net_minor,
            ${PAYOUT_STATE} AS payout_state
     ${RUN_FROM}
     WHERE r.state = 'committed' AND ${HAS_STATEMENT} AND ($2::uuid IS NULL OR m.id = $2)
       AND ($3::timestamptz IS NULL OR (p.starts_at, r.id) < ($3, $4::uuid))
     ORDER BY p.starts_at DESC, r.id DESC LIMIT $5`,
    [participantId, marketId ?? null, after?.starts_at ?? null, after?.run_id ?? null, limit + 1],
  )
  return rows.map((row) => ({ ...head(row), net_minor: row.net_minor, payout_state: row.payout_state }))
}

async function committedRun(tx: Tx, participantId: string, runId: string): Promise<StatementRow> {
  const { rows } = await tx.query<StatementRow>(`SELECT ${RUN_COLUMNS} ${RUN_FROM} WHERE r.id = $2 AND r.state = 'committed' AND ${HAS_STATEMENT}`, [participantId, runId])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

interface Blocker { readonly reason: string; readonly detail: { readonly until?: string; readonly case_id?: string } }

/** Payout status (AC-DIST1-2): the instructions of the run's period and the market's blockers as codes only. */
async function payoutStatus(tx: Tx, participantId: string, run: StatementRow) {
  const { rows: instructions } = await tx.query(
    `SELECT i.amount_minor::text, i.state, i.terminal_at, v.masked
     FROM payout_instruction i JOIN bank_detail_version v ON v.id = i.bank_detail_version_id
     WHERE i.payee_participant_id = $1 AND pay_batch_period(i.batch_id) = $2
       AND NOT EXISTS (SELECT 1 FROM payout_instruction n WHERE n.retry_of = i.id)
     ORDER BY i.created_at, i.id`,
    [participantId, run.period_id],
  )
  const { rows } = await tx.query<{ blockers: Blocker[] }>('SELECT pay_payee_blockers($1, $2) AS blockers', [participantId, run.market_id])
  // A hold's staff-written reason, id and placed_at never reach the payee (D-B5-07).
  const blockers = rows[0]!.blockers.map(({ reason, detail }) => ({
    reason, ...(detail.until === undefined ? {} : { until: detail.until }), ...(detail.case_id === undefined ? {} : { case_id: detail.case_id }),
  }))
  return { instructions, blockers }
}

/** The statement of one committed run for the participant; 404 when there is none; 500 INVARIANT_FAILED (logged). */
export async function statementDetail(tx: Tx, participantId: string, runId: string, log: FastifyBaseLogger) {
  const run = await committedRun(tx, participantId, runId)
  const { rows: lines } = await tx.query<StatementLine>(
    `SELECT l.id, l.payee_position_id AS position_id, x.position_ref, l.rule_key, l.amount_minor::text, l.origin_type, l.original_period_id
     FROM result_line l JOIN position x ON x.id = l.payee_position_id
     WHERE l.run_id = $1 AND l.payee_participant_id = $2 ORDER BY x.position_ref, l.payee_position_id, l.rule_key, l.id`,
    [runId, participantId],
  )
  const { rows: settlement } = await tx.query<Settlement>(
    `SELECT gross_minor::text, netted_minor::text, withheld_minor::text, net_payable_minor::text FROM run_settlement
     WHERE run_id = $1 AND payee_participant_id = $2`,
    [runId, participantId],
  )
  const positionIds = [...new Set(lines.map((l) => l.position_id))]
  const { rows: states } = await tx.query<{ position_id: string; paid_as: LadderRank[] }>(
    'SELECT position_id, paid_as_rank AS paid_as FROM qualification_state WHERE run_id = $1 AND position_id = ANY ($2::uuid[])', [runId, positionIds])
  const { invariant, ...body } = buildStatement(lines, settlement[0] ?? null, new Map(states.map((s) => [s.position_id, s.paid_as])))
  if (!invariant) {
    log.error({ runId, participantId, summary: body.summary }, 'statement invariant failed: net <> gross - withheld - clawback + adjustment')
    throw new ApiError(500, 'INVARIANT_FAILED', 'This statement does not add up; it has been reported.')
  }
  return { ...head(run), ...body, payout: await payoutStatus(tx, participantId, run), disclosure_url: null }
}

const CSV_HEADER = ['record', 'position_ref', 'rule_key', 'line_id', 'origin_kind', 'original_period_id', 'amount', 'currency']

/** GET …/download (AC-DIST1-3): the statement's figures as CSV, decimal amounts by string arithmetic; audited. */
export async function statementCsv(tx: Tx, participantId: string, runId: string, log: FastifyBaseLogger): Promise<{ csv: string; name: string }> {
  const statement = await statementDetail(tx, participantId, runId, log)
  const { currency, minor_unit: digits } = statement.market
  const amount = (minor: string) => formatUnits(BigInt(minor), digits)
  const rows: unknown[][] = []
  for (const position of statement.positions) {
    for (const bonus of position.bonuses) {
      for (const line of bonus.lines) {
        rows.push(['line', position.position_ref, bonus.rule_key, line.id, line.origin_kind, line.original_period_id, amount(line.amount_minor), currency])
      }
    }
    rows.push(['position_total', position.position_ref, null, null, null, null, amount(position.total_minor), currency])
  }
  rows.push(['person_total', null, null, null, null, null, amount(statement.person_total_minor), currency])
  const { gross_minor, adjustment_minor, clawback_minor, withheld_minor, net_minor } = statement.summary
  for (const [record, minor] of [['gross', gross_minor], ['adjustment', adjustment_minor], ['clawback', clawback_minor], ['withheld', withheld_minor], ['net', net_minor]] as const) {
    rows.push([record, null, null, null, null, null, amount(minor), currency])
  }
  await recordAudit(tx, { action: 'STATEMENT.DOWNLOADED', objectType: 'run', objectId: runId, after: { run_id: runId } })
  return { csv: toCsv(CSV_HEADER, rows), name: `statement-${marketDay(statement.period.starts_at, statement.market.time_zone)}.csv` }
}

interface ExplainedLine {
  readonly id: string
  readonly run_id: string
  readonly rule_key: string
  readonly amount_minor: string
  readonly currency: string
  readonly origin_type: string | null
  readonly trace: string
  readonly starts_at: Date
  readonly ends_at: Date
  readonly minor_unit: number
  readonly time_zone: string
  readonly original_period: { id: string; starts_at: string; ends_at: string } | null
}

/**
 * GET /v1/me/statement-lines/:id/explanation (FR-DIST-002): the participant's line of a committed run, else 404. A kind
 * without a template is logged (explanation_template_missing); a trace that does not reach the amount is 500 TRACE_MISMATCH.
 */
export async function lineExplanation(tx: Tx, participantId: string, lineId: string, log: FastifyBaseLogger) {
  const { rows } = await tx.query<ExplainedLine>(
    `SELECT l.id, l.run_id, l.rule_key, l.amount_minor::text, l.currency, l.origin_type, l.trace::text AS trace, p.starts_at,
            p.ends_at, m.minor_unit, m.time_zone,
            (SELECT jsonb_build_object('id', o.id, 'starts_at', json_instant(o.starts_at), 'ends_at', json_instant(o.ends_at))
             FROM period o WHERE o.id = l.original_period_id) AS original_period
     FROM result_line l JOIN run r ON r.id = l.run_id AND r.state = 'committed' JOIN period p ON p.id = r.period_id
     JOIN calendar c ON c.id = p.calendar_id JOIN market m ON m.id = c.market_id
     WHERE l.id = $1 AND l.payee_participant_id = $2`,
    [lineId, participantId],
  )
  const line = rows[0]
  if (line === undefined) throw notFound()
  const trace = traceFromJson(line.trace)
  const original = line.original_period
  const body = explainLine({
    line, trace, rule: { key: line.rule_key, name: ruleName(line.rule_key) }, period: line, timeZone: line.time_zone, minorDigits: line.minor_unit,
    origin: line.origin_type === null ? null : {
      kind: originKind(line.origin_type, BigInt(line.amount_minor)),
      original_period: original === null ? null : { id: original.id, starts_at: new Date(original.starts_at), ends_at: new Date(original.ends_at) },
    },
  })
  if (body.template === 'generic') log.warn({ rule_key: line.rule_key, kind: trace.kind }, 'explanation_template_missing')
  if (!body.reconciles) {
    log.error({ lineId, runId: line.run_id }, 'stored trace does not reach the line amount')
    throw new ApiError(500, 'TRACE_MISMATCH', 'The explanation of this line does not match its amount; it has been reported.')
  }
  return body
}
