import type { Tx } from '@nmp/db'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { decodeCursor, toPage } from '../../lib/pagination.js'
import type { Envelope } from '../../lib/http.js'
import { changedKeys } from './timeline.js'

/** Whether the caller may see a key's values (registry read permissions; the structure is visible to every reader). */
export type KeyVisibility = (key: string) => boolean

interface HistoryRow {
  id: string
  version: number
  effective_from: Date
  reason: string
  created_at: Date
  created_by: string
  created_by_name: string | null
  approver_id: string | null
  approver_name: string | null
  approved_at: Date | null
  superseded_by_version: number | null
  settings: Record<string, unknown>
  previous: Record<string, unknown> | null
}

// The predecessor of a version is the chain row in force just before its date when it was inserted: among earlier
// versions, the latest effective_from strictly before it, highest version first. A rebased row thus diffs against its new
// predecessor, not the row it rebases (BUG-050), and a change superseding a same-date row shows all that changes at that
// date. Ordering by version alone would skip a later-dated row that a rebase left in place (phantom changes).
const HISTORY_SELECT = `
  SELECT v.id, v.version, v.effective_from, v.reason, v.created_at, v.created_by, cu.display_name AS created_by_name,
         a.approver_id, au.display_name AS approver_name, a.decided_at AS approved_at, v.settings,
         (SELECT min(s.version) FROM tenant_setting_version s
          WHERE s.effective_from = v.effective_from AND s.version > v.version)::int AS superseded_by_version,
         (SELECT p.settings FROM tenant_setting_version p
          WHERE p.version < v.version AND p.effective_from < v.effective_from
          ORDER BY p.effective_from DESC, p.version DESC LIMIT 1) AS previous
  FROM tenant_setting_version v
  LEFT JOIN user_account cu ON cu.id = v.created_by
  LEFT JOIN approval a ON a.id = v.approval_id
  LEFT JOIN user_account au ON au.id = a.approver_id`

export interface VersionSummary {
  id: string
  version: number
  effective_from: Date
  reason: string
  created_at: Date
  created_by: { id: string; display_name: string | null }
  approval: { approver: { id: string; display_name: string | null }; decided_at: Date } | null
  superseded_by_version: number | null
  changed: { key: string }[]
}

function summary(row: HistoryRow): VersionSummary {
  return {
    id: row.id, version: row.version, effective_from: row.effective_from, reason: row.reason, created_at: row.created_at,
    created_by: { id: row.created_by, display_name: row.created_by_name },
    approval: row.approver_id === null ? null : { approver: { id: row.approver_id, display_name: row.approver_name }, decided_at: row.approved_at! },
    superseded_by_version: row.superseded_by_version,
    changed: changedKeys(row.previous ?? {}, row.settings).map((key) => ({ key })),
  }
}

/** GET /v1/settings/versions: newest first, cursor = version. */
export async function listVersions(tx: Tx, query: { cursor?: string; limit: number }): Promise<Envelope<VersionSummary[]>> {
  const before = decodeCursor(query.cursor, z.number().int().positive())
  const { rows } = await tx.query<HistoryRow>(
    `${HISTORY_SELECT} WHERE ($1::int IS NULL OR v.version < $1) ORDER BY v.version DESC LIMIT $2`,
    [before ?? null, query.limit + 1],
  )
  return toPage(rows.map(summary), query.limit, (row) => row.version)
}

interface StructureEntry {
  readonly id: string
  readonly [field: string]: unknown
}

const STRUCTURE_PARTS = ['markets', 'brands', 'calendars'] as const

function entries(structure: unknown, part: (typeof STRUCTURE_PARTS)[number]): Map<string, StructureEntry> {
  const list = (structure as Record<string, StructureEntry[] | undefined> | null | undefined)?.[part] ?? []
  return new Map(list.map((entry) => [entry.id, entry]))
}

/** Structure changes by id (D-B1-02): what a market, brand or calendar change did. */
function structureDiff(before: unknown, after: unknown) {
  return Object.fromEntries(STRUCTURE_PARTS.map((part) => {
    const old = entries(before, part)
    const next = entries(after, part)
    return [part, {
      added: [...next.values()].filter((entry) => !old.has(entry.id)),
      removed: [...old.values()].filter((entry) => !next.has(entry.id)),
      changed: [...next.values()]
        .filter((entry) => old.has(entry.id) && !isDeepStrictEqual(old.get(entry.id), entry))
        .map((entry) => ({ id: entry.id, before: old.get(entry.id), after: entry })),
    }]
  }))
}

/** GET /v1/settings/versions/:version: the row and its changes; values the caller may not read are redacted. */
export async function versionDetail(tx: Tx, version: number, visible: KeyVisibility) {
  const { rows } = await tx.query<HistoryRow>(`${HISTORY_SELECT} WHERE v.version = $1`, [version])
  const row = rows[0]
  if (row === undefined) return null
  const previous = row.previous ?? {}
  const changes = changedKeys(previous, row.settings).map((key) => {
    if (key === 'structure') return { key, ...structureDiff(previous.structure, row.settings.structure) }
    if (!visible(key)) return { key, redacted: true }
    return { key, before: previous[key] ?? null, after: row.settings[key] ?? null }
  })
  return { ...summary(row), changes }
}
