import type { Tx } from '@nmp/db'
import { appendVersion, lockSettings, type AppendedVersion } from './versions.js'

/**
 * D-B1-02: the tenant's markets, brands and calendars (with the end of their last generated period) as stored in
 * settings.structure, sorted by id. Not a registry key: never served by /v1/settings/:key; a run (B3) that records a
 * settings version pins it too.
 */
export async function structureSnapshot(tx: Tx): Promise<Record<string, unknown>> {
  const { rows } = await tx.query<{ structure: Record<string, unknown> }>(
    `SELECT jsonb_build_object(
       'markets', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'code', code, 'currency', currency,
           'minor_unit', minor_unit, 'time_zone', time_zone, 'languages', languages, 'market_pack', market_pack,
           'state', state) ORDER BY id) FROM market), '[]'),
       'brands', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY id) FROM brand), '[]'),
       'calendars', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'market_id', c.market_id, 'name', c.name,
           'cadence', c.cadence, 'cutoff_time_zone', c.cutoff_time_zone, 'first_period_start', c.first_period_start,
           'periods_through', (SELECT max(p.ends_at) FROM period p WHERE p.calendar_id = c.id)) ORDER BY c.id)
         FROM calendar c), '[]')) AS structure`,
  )
  return rows[0]!.structure
}

/**
 * Appends a settings version, effective now (or at `effectiveFrom`: only the e2e seed backdates, BUG-085), holding the
 * structure after the caller's change (same transaction). The snapshot is read after the settings lock, so it includes
 * every structure change committed before this one.
 */
export async function recordStructureChange(tx: Tx, reason: string, effectiveFrom: Date | null = null): Promise<AppendedVersion> {
  await lockSettings(tx)
  return appendVersion(tx, { effectiveFrom, patch: { structure: await structureSnapshot(tx) }, reason, approvalId: null, key: 'structure' })
}
