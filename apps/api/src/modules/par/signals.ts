import { createHmac, hkdfSync } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { openSystemCase } from '../cas/index.js'
import { getSetting } from '../ten/index.js'
import { SIGNAL_KINDS, type SignalKind, type SignalsBody } from './schemas.js'

const DIGEST_BYTES = 32

/** NFKC, trimmed, inner whitespace collapsed, lower case: the same identity written two ways gives one digest. */
export function normaliseSignal(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * D-B2-10: HMAC-SHA256 of the normalised value under HKDF(SECRET_ENCRYPTION_KEY, "dup:<tenant>:<kind>"). Per tenant and
 * kind, so digests of two tenants (or of two kinds) never compare equal; the raw value is never stored or logged.
 */
export function signalDigest(secretKey: Buffer, tenantId: string, kind: SignalKind, value: string): Buffer {
  const key = Buffer.from(hkdfSync('sha256', secretKey, Buffer.alloc(0), `dup:${tenantId}:${kind}`, DIGEST_BYTES))
  return createHmac('sha256', key).update(normaliseSignal(value), 'utf8').digest()
}

/** The hex digests of the given signals, by kind: what a request keeps instead of the raw values. */
export type SignalDigests = Partial<Record<SignalKind, string>>

/**
 * D-B2-10: the digests of the signals. Routes replace the raw values in request.body with them before idempotent(), so
 * the Idempotency-Key's unkeyed request hash never covers a raw value.
 */
export function digestSignals(secretKey: Buffer, tenantId: string, signals: SignalsBody): SignalDigests {
  return Object.fromEntries(SIGNAL_KINDS.flatMap((kind) => {
    const value = signals[kind]
    return value === undefined ? [] : [[kind, signalDigest(secretKey, tenantId, kind, value).toString('hex')]]
  }))
}

/**
 * Stores the digests (a known digest is not stored twice); returns the kinds added. Concurrent writes serialise: the
 * audit insert takes the tenant's audit-chain lock (0003) until commit, so a findDuplicates after it sees every digest
 * a concurrent transaction stored. Call findDuplicates after this, never before.
 */
export async function addSignals(tx: Tx, participantId: string, digests: SignalDigests): Promise<SignalKind[]> {
  const given = SIGNAL_KINDS.filter((kind) => digests[kind] !== undefined)
  const { rows } = await tx.query<{ kind: SignalKind }>(
    `INSERT INTO participant_signal (tenant_id, participant_id, kind, digest)
     SELECT app_tenant_id(), $1, s.kind, decode(s.digest, 'hex') FROM unnest($2::text[], $3::text[]) AS s (kind, digest)
     ON CONFLICT (participant_id, kind, digest) DO NOTHING RETURNING kind`,
    [participantId, given, given.map((kind) => digests[kind])],
  )
  const added = rows.map((row) => row.kind)
  if (added.length > 0) {
    await recordAudit(tx, {
      action: 'PARTICIPANT.SIGNALS_ADDED', objectType: 'participant', objectId: participantId, after: { kinds: added },
    })
  }
  return added
}

export interface DuplicateMatch {
  readonly participant_id: string
  readonly kinds: SignalKind[]
}

export interface DuplicateCheck {
  readonly matches: DuplicateMatch[]
  /** The setting's hold_activation: a match holds the participant's new positions pending (D-B2-10). */
  readonly hold: boolean
}

/**
 * Active participants sharing at least min_matches of the configured kinds with the participant, strongest first.
 * participants.duplicate_matching unset: no matching (AC-PAR3-3 b).
 */
export async function findDuplicates(tx: Tx, participantId: string): Promise<DuplicateCheck> {
  const config = await getSetting(tx, 'participants.duplicate_matching')
  if (config === null) return { matches: [], hold: false }
  const { rows } = await tx.query<DuplicateMatch>(
    `SELECT other.participant_id, array_agg(DISTINCT other.kind ORDER BY other.kind) AS kinds
     FROM participant_signal mine
     JOIN participant_signal other ON other.kind = mine.kind AND other.digest = mine.digest
       AND other.participant_id <> mine.participant_id
     JOIN participant p ON p.id = other.participant_id AND p.status = 'active'
     WHERE mine.participant_id = $1 AND mine.kind = ANY ($2::text[])
     GROUP BY other.participant_id HAVING count(DISTINCT other.kind) >= $3
     ORDER BY count(DISTINCT other.kind) DESC, other.participant_id`,
    [participantId, config.signals, config.min_matches],
  )
  return { matches: rows, hold: config.hold_activation }
}

/**
 * One system-opened duplicate case per matched participant not already under an open or submitted review with this
 * participant (FR-PAR-003); returns the strongest match's case (opened now or already under review), or null.
 */
export async function openDuplicateCases(tx: Tx, participantId: string, marketId: string, matches: DuplicateMatch[]): Promise<string | null> {
  const caseIds: string[] = []
  for (const match of matches) {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM case_file WHERE type = 'duplicate' AND state IN ('open', 'submitted') AND subject_id = $1
         AND payload ->> 'matched_participant_id' = $2::text`,
      [participantId, match.participant_id],
    )
    const existing = rows[0]?.id
    caseIds.push(existing ?? (await openSystemCase(tx, {
      type: 'duplicate', subjectType: 'participant', subjectId: participantId, reasonCode: 'SIGNAL_MATCH',
      payload: { matched_participant_id: match.participant_id, matched_kinds: match.kinds }, marketId,
    })).id)
  }
  return caseIds[0] ?? null
}
