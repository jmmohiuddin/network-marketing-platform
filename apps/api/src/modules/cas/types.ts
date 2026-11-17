import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import type { z } from 'zod'
import type { Permission } from '../../lib/permissions.js'

/** The case types of DATABASE section 7 (case_file.type CHECK). */
export const CASE_TYPES = [
  'genealogy_change', 'genealogy_correction', 'duplicate', 'transfer', 'adjustment', 'dispute', 'restatement',
  'returned_payment', 'write_off', 'bank_detail', 'grievance', 'privacy',
] as const

export type CaseType = (typeof CASE_TYPES)[number]

export type CaseState = 'open' | 'submitted' | 'approved' | 'rejected' | 'withdrawn'

/** A case_file row as the API shows it and the type hooks receive it. */
export interface CaseRecord<P = unknown> {
  readonly id: string
  readonly type: CaseType
  readonly subject_type: string
  readonly subject_id: string
  readonly reason_code: string
  readonly state: CaseState
  readonly payload: P
  readonly effect_preview: unknown
  readonly due_at: Date | null
  readonly market_id: string | null
  /** null for a case the system opened (D-B2-04, type duplicate only). */
  readonly opened_by: string | null
  readonly opened_by_kind: 'user' | 'system'
  readonly assigned_to: string | null
  readonly submitted_by: string | null
  readonly submitted_at: Date | null
  readonly decided_at: Date | null
  readonly approval_id: string | null
  readonly created_at: Date
}

export interface CaseTypePermissions {
  readonly read: Permission
  readonly create: Permission
  readonly decide: Permission
}

/** What a later increment registers to enable a case type (PLAN B1 section 2.9, D-B1-13). */
export interface CaseTypeDefinition<P = unknown> {
  readonly type: CaseType
  readonly subjectTypes: readonly string[]
  readonly reasonCodes: readonly string[]
  /** Reason codes only the system opens a case with (D-B2-04): users cannot choose them. */
  readonly systemReasonCodes?: readonly string[]
  readonly evidenceRequired: boolean
  readonly permissions: CaseTypePermissions
  readonly payload: z.ZodType<P>
  /**
   * SQL over the case_file row `c`: the market of another object the payload names (e.g. the matched participant of a
   * duplicate review), or NULL. A reader then needs the read permission over that market too: the case reveals it.
   */
  readonly relatedMarketSql?: string
  /** The subject in the caller's tenant transaction, or null when it does not exist. */
  resolveSubject(tx: Tx, subjectType: string, subjectId: string): Promise<{ marketId: string | null } | null>
  /**
   * Type checks of a new or changed case (PLAN B2 section 2.4): runs after resolveSubject at create and after the payload
   * is validated again at PATCH; throws an ApiError and nothing is stored. `scope`: the markets the caller's create
   * permission covers (null = all), for objects the payload names besides the subject. `stored`: the case as stored, at
   * PATCH only.
   */
  validateCreate?(
    tx: Tx, subject: { readonly type: string; readonly id: string }, payload: P, scope: readonly string[] | null,
    stored?: CaseRecord<P>,
  ): Promise<void>
  effectPreview?(tx: Tx, c: CaseRecord<P>): Promise<unknown>
  dueAt?(tx: Tx, c: CaseRecord<P>): Promise<Date | null>
  /** Runs in the decision's transaction, after the case is approved or rejected. */
  onDecision?(tx: Tx, c: CaseRecord<P>, decision: 'approved' | 'rejected'): Promise<void>
}

/** The case types one app enables, by type. */
export type CaseTypeRegistry = ReadonlyMap<CaseType, CaseTypeDefinition>

const EMPTY: CaseTypeRegistry = new Map()

// One registry per app, keyed by the app's HTTP server: every encapsulated module scope of an app shares it, so AUD
// (a sibling scope) finds the types CAS mounted, and another app in the same process never sees them.
const registries = new WeakMap<object, CaseTypeRegistry>()

export function caseTypeRegistry(types: readonly CaseTypeDefinition[]): CaseTypeRegistry {
  const entries = types.map((definition) => [definition.type, definition] as const)
  const registry: CaseTypeRegistry = new Map(entries)
  if (registry.size !== entries.length) throw new Error('a case type is registered twice')
  return registry
}

export function mountCaseTypes(app: FastifyInstance, registry: CaseTypeRegistry): void {
  if (registries.has(app.server)) throw new Error('the case module is mounted twice in one app')
  registries.set(app.server, registry)
}

/** The case types of the app (empty when CAS is not mounted). Read it per request: modules mount in any order. */
export function caseTypesOf(app: FastifyInstance): CaseTypeRegistry {
  return registries.get(app.server) ?? EMPTY
}

export function caseTypeOf(registry: CaseTypeRegistry, type: string): CaseTypeDefinition | undefined {
  return registry.get(type as CaseType)
}
