import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { MAX_CODE_LENGTH, MAX_CODES, PURPOSES, SOURCE_KINDS, type Purpose, type SourceKind } from './vocabulary.js'

const UNIQUE_VIOLATION = '23505'

const codeMap = <T extends z.ZodType>(target: T) =>
  z.record(z.string().min(1).max(MAX_CODE_LENGTH), target).refine((map) => Object.keys(map).length <= MAX_CODES, {
    message: `at most ${MAX_CODES} codes`,
  })

/** BR-PTY-01 flags of a participant type. */
const participantFlags = z.strictObject({ counts_as_end_customer: z.boolean(), can_earn: z.boolean() })

/** import_mapping.mappings: partner code -> platform vocabulary (FR-IMP-002). */
export const mappingsSchema = z.strictObject({
  participant_types: codeMap(participantFlags),
  purposes: codeMap(z.enum(PURPOSES)),
  source_kinds: codeMap(z.enum(SOURCE_KINDS)),
  /** is_starter_kit partner code -> starter kit or not; 0, 1 and empty keep their published meaning unless named. */
  starter_kits: codeMap(z.boolean()).default({}),
})
export type Mappings = z.infer<typeof mappingsSchema>
export type ParticipantFlags = z.infer<typeof participantFlags>

export interface MappingView {
  id: string
  version: number
  state: 'draft' | 'approved'
  notes: string | null
  created_by: string | null
  created_at: Date
  approved_by: string | null
  mappings?: Mappings
}

const SUMMARY = 'id, version, state, notes, created_by, created_at, approved_by'

export async function latestMappingVersion(tx: Tx): Promise<number> {
  const { rows } = await tx.query<{ version: number | null }>('SELECT max(version) AS version FROM import_mapping')
  return rows[0]?.version ?? 0
}

/** Newest version first; the cursor is the version of the last one shown. */
export async function listMappings(tx: Tx, beforeVersion: number | undefined, limit: number): Promise<MappingView[]> {
  const { rows } = await tx.query<MappingView>(
    `SELECT ${SUMMARY} FROM import_mapping WHERE ($1::int IS NULL OR version < $1) ORDER BY version DESC LIMIT $2`,
    [beforeVersion ?? null, limit + 1],
  )
  return rows
}

export async function getMapping(tx: Tx, id: string): Promise<MappingView | null> {
  const { rows } = await tx.query<MappingView>(`SELECT ${SUMMARY}, mappings FROM import_mapping WHERE id = $1`, [id])
  return rows[0] ?? null
}

export interface MappingDraft {
  readonly mappings: Mappings
  readonly notes: string | null
  /** The latest version the client saw (If-Match); 0 when the tenant has none. */
  readonly expectedVersion: number
}

const preconditionFailed = (latest: number): ApiError =>
  new ApiError(412, 'PRECONDITION_FAILED', 'The mapping changed since you loaded it. Reload and try again.', { latest_version: latest })

const sizeOf = (mappings: Mappings) => ({
  participant_types: Object.keys(mappings.participant_types).length,
  purposes: Object.keys(mappings.purposes).length,
  source_kinds: Object.keys(mappings.source_kinds).length,
  starter_kits: Object.keys(mappings.starter_kits).length,
})

/** Saving always creates a new draft version (FR-IMP-002); approved versions are never edited. */
export async function createMappingVersion(tx: Tx, draft: MappingDraft): Promise<MappingView> {
  const latest = await latestMappingVersion(tx)
  if (latest !== draft.expectedVersion) throw preconditionFailed(latest)
  let created: MappingView
  try {
    const { rows } = await tx.query<MappingView>(
      `INSERT INTO import_mapping (tenant_id, version, mappings, notes, state, created_by)
       VALUES (app_tenant_id(), $1, $2, $3, 'draft', current_setting('app.user_id')::uuid)
       RETURNING ${SUMMARY}, mappings`,
      [latest + 1, draft.mappings, draft.notes],
    )
    created = rows[0]!
  } catch (error) {
    // A concurrent save took this version number first.
    if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) throw preconditionFailed(latest + 1)
    throw error
  }
  await recordAudit(tx, {
    action: 'MAPPING.VERSION_CREATED', objectType: 'import_mapping', objectId: created.id,
    before: { version: latest }, after: { version: created.version, state: 'draft', codes: sizeOf(draft.mappings) },
  })
  return created
}

export interface MappingApproval {
  readonly userId: string
  readonly stepUpAt: Date | null
  readonly reason: string | null
}

/** Approval by a user other than the author (SoD), with the second factor recorded (C-4). Approved = immutable. */
export async function approveMapping(tx: Tx, id: string, approval: MappingApproval): Promise<MappingView> {
  const { rows } = await tx.query<{ version: number; state: string; created_by: string }>(
    'SELECT version, state, created_by FROM import_mapping WHERE id = $1 FOR UPDATE',
    [id],
  )
  const current = rows[0]
  if (current === undefined) throw notFound()
  if (current.state === 'approved') throw new ApiError(409, 'MAPPING_ALREADY_APPROVED', 'This mapping version is already approved.')
  if (current.created_by === approval.userId) {
    throw new ApiError(422, 'SOD_SELF_APPROVAL', 'A mapping version must be approved by someone other than its author.')
  }
  await tx.query(`UPDATE import_mapping SET state = 'approved', approved_by = $2 WHERE id = $1`, [id, approval.userId])
  const decided = await tx.query<{ id: string }>(
    `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason,
       factor_verified_at, decided_at, created_by)
     VALUES (app_tenant_id(), 'import_mapping', $1, $2, $3, 'approved', $4, $5, now(), $3)
     RETURNING id`,
    [id, current.created_by, approval.userId, approval.reason, approval.stepUpAt],
  )
  await recordAudit(tx, {
    action: 'MAPPING.APPROVED', objectType: 'import_mapping', objectId: id,
    before: { version: current.version, state: 'draft' },
    after: { version: current.version, state: 'approved', approval_id: decided.rows[0]!.id },
    ...(approval.reason === null ? {} : { reason: approval.reason }),
  })
  return (await getMapping(tx, id))!
}

/** A mapping version applied to partner codes: unmapped purposes and source kinds become 'unknown'. */
export interface ResolvedMapping {
  participantFlags(code: string): ParticipantFlags | undefined
  purpose(code: string): Purpose
  sourceKind(code: string): SourceKind
  /** undefined: a code other than the published 0, 1 or empty that the mapping does not name. */
  starterKit(code: string): boolean | undefined
}

/** is_starter_kit as the published format writes it (MVP_A 3.1: 0 or 1, empty = 0). */
const PUBLISHED_STARTER_KIT: ReadonlyMap<string, boolean> = new Map([['', false], ['0', false], ['1', true]])

export function resolveMapping(mappings: Mappings): ResolvedMapping {
  // Maps, not object lookups: a partner code such as 'constructor' must not hit Object.prototype.
  const types = new Map(Object.entries(mappings.participant_types))
  const purposes = new Map(Object.entries(mappings.purposes))
  const kinds = new Map(Object.entries(mappings.source_kinds))
  const kits = new Map(Object.entries(mappings.starter_kits))
  return {
    participantFlags: (code) => types.get(code),
    purpose: (code) => purposes.get(code) ?? 'unknown',
    sourceKind: (code) => kinds.get(code) ?? 'unknown',
    starterKit: (code) => kits.get(code) ?? PUBLISHED_STARTER_KIT.get(code),
  }
}
