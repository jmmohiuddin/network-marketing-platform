import type { Tx } from '@nmp/db'
import { getSetting } from '../ten/index.js'

// FR-INT-002 / API-37: sync health per commerce connector and per API source system seen in inbound events.
// shortcut: inbound-only sources have no heartbeat, so a quiet store drifts to behind; add pull heartbeats with V1
// reconciliation.

type State = 'healthy' | 'behind' | 'failing' | 'thresholds_not_set'

interface Thresholds {
  readonly behind_after_minutes: number
  readonly failing_after_minutes: number
}

interface SourceRow {
  source: string
  kind: 'connector' | 'api'
  connector_id: string | null
  provider: string | null
  name: string
  market: { id: string; code: string } | null
  last_success_at: Date | null
  lag_seconds: number | null
  errors_24h: number
  held: number
  held_overdue: number
  last_error: { code: string; at: Date } | null
  last_state: string | null
}

const SOURCES = `
  WITH sources AS (
    SELECT 'connector:' || c.id AS source, 'connector' AS kind, c.id AS connector_id, c.provider, c.name,
           jsonb_build_object('id', m.id, 'code', m.code) AS market
    FROM provider_config c JOIN market m ON m.id = c.market_id WHERE c.kind = 'commerce' AND c.state = 'recorded'
    UNION ALL
    SELECT DISTINCT i.source, 'api', NULL::uuid, NULL, substr(i.source, 5), NULL::jsonb FROM inbound_event i WHERE i.source LIKE 'api:%'
  )
  SELECT s.*, ok.at AS last_success_at, extract(epoch FROM now() - ok.at)::int AS lag_seconds,
    (SELECT count(*)::int FROM inbound_event i WHERE i.source = s.source AND i.state = 'rejected' AND i.received_at > now() - interval '24 hours') AS errors_24h,
    (SELECT count(*)::int FROM inbound_event i WHERE i.source = s.source AND i.state = 'held') AS held,
    (SELECT count(*)::int FROM inbound_event i WHERE i.source = s.source AND i.state = 'held' AND i.received_at <= now() - interval '24 hours') AS held_overdue,
    (SELECT jsonb_build_object('code', i.result -> 'error' ->> 'code', 'at', i.processed_at) FROM inbound_event i
     WHERE i.source = s.source AND i.state = 'rejected' ORDER BY i.received_at DESC, i.id DESC LIMIT 1) AS last_error,
    (SELECT i.state FROM inbound_event i WHERE i.source = s.source ORDER BY i.received_at DESC, i.id DESC LIMIT 1) AS last_state
  FROM sources s
  LEFT JOIN LATERAL (SELECT max(i.processed_at) AS at FROM inbound_event i WHERE i.source = s.source AND i.state = 'processed') ok ON true
  ORDER BY s.kind DESC, s.name, s.source`

/** failing (last event rejected, a held item older than 24 h, lag over failing_after) > behind > healthy. */
export function stateOf(row: Pick<SourceRow, 'last_state' | 'held_overdue' | 'lag_seconds'>, thresholds: Thresholds | null): State {
  const lagOver = (minutes: number) => row.lag_seconds !== null && row.lag_seconds > minutes * 60
  if (row.last_state === 'rejected' || row.held_overdue > 0 || (thresholds !== null && lagOver(thresholds.failing_after_minutes))) return 'failing'
  if (thresholds === null) return 'thresholds_not_set'
  return lagOver(thresholds.behind_after_minutes) ? 'behind' : 'healthy'
}

export async function syncHealth(tx: Tx): Promise<{ sources: Record<string, unknown>[]; thresholds: Thresholds | null }> {
  const thresholds = await getSetting(tx, 'integrations.sync_health')
  const { rows } = await tx.query<SourceRow>(SOURCES)
  const sources = rows.map(({ last_state: lastState, connector_id: connectorId, provider, market, ...row }) => ({
    ...row,
    ...(row.kind === 'connector' ? { connector_id: connectorId, provider, market } : {}),
    state: stateOf({ last_state: lastState, held_overdue: row.held_overdue, lag_seconds: row.lag_seconds }, thresholds),
  }))
  return { sources, thresholds }
}
