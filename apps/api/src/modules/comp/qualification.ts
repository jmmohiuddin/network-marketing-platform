import type { Tx } from '@nmp/db'
import { notFound } from '../../lib/errors.js'

// FR-COMP-004 / AC-46.1: a position's qualification state per committed period, read-only (no route writes state).

export interface QualificationCursor {
  readonly starts_at: string
  readonly period_id: string
}

export async function positionQualification(
  tx: Tx, positionId: string, scope: readonly string[] | null, calendarId: string | undefined, after: QualificationCursor | undefined, limit: number,
) {
  const { rows: position } = await tx.query<{ market_id: string }>('SELECT market_id FROM position WHERE id = $1', [positionId])
  if (position[0] === undefined || (scope !== null && !scope.includes(position[0].market_id))) throw notFound()
  const { rows } = await tx.query(
    `SELECT jsonb_build_object('id', p.id, 'starts_at', p.starts_at, 'ends_at', p.ends_at, 'calendar_id', p.calendar_id) AS period,
            r.id AS run_id, jsonb_build_object('id', v.id, 'version', v.version) AS plan_version, q.paid_as_rank AS paid_as,
            q.highest_titles AS titles, q.grace_used, q.counters, q.carry, q.one_time_flags, q.banked, q.measures,
            p.starts_at AS cursor_starts_at
     FROM qualification_state q JOIN run r ON r.id = q.run_id AND r.state = 'committed' JOIN period p ON p.id = r.period_id
     JOIN plan_version v ON v.id = r.plan_version_id
     WHERE q.position_id = $1 AND ($2::uuid IS NULL OR p.calendar_id = $2)
       AND ($3::timestamptz IS NULL OR (p.starts_at, p.id) < ($3, $4::uuid))
     ORDER BY p.starts_at DESC, p.id DESC LIMIT $5`,
    [positionId, calendarId ?? null, after?.starts_at ?? null, after?.period_id ?? null, limit + 1],
  )
  return rows as ({ period: { id: string }; cursor_starts_at: Date } & Record<string, unknown>)[]
}
