import { isDeepStrictEqual } from 'node:util'

// D-B1-01: the settings timeline. A row's settings are exactly what is in force from its effective_from until the next
// row of the chain; the chain is, for each distinct effective_from, the row with the highest version.

export type Settings = Readonly<Record<string, unknown>>

export interface ChainRow {
  readonly id: string
  readonly version: number
  readonly effectiveFrom: Date
  readonly settings: Settings
  readonly approvalId: string | null
  readonly reason: string
}

export interface TimelineChange {
  readonly effectiveFrom: Date
  /** Keys set by the change (a money key, a threshold, the structure snapshot). */
  readonly patch: Settings
  readonly reason: string
  readonly approvalId: string | null
}

export interface NewVersion {
  readonly version: number
  readonly effectiveFrom: Date
  readonly settings: Settings
  readonly approvalId: string | null
  readonly reason: string
  /** The chain row this row rebases (its effective_from is copied exactly); null for the change itself. */
  readonly rebases: string | null
}

/** The chain row in force at `at`, or undefined. `chain` is ascending by effectiveFrom. */
export function inForceAt(chain: readonly ChainRow[], at: Date): ChainRow | undefined {
  return chain.findLast((row) => row.effectiveFrom.getTime() <= at.getTime())
}

/** Keys whose value differs between two settings objects (absent and present count as different). */
export function changedKeys(before: Settings, after: Settings): string[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  return keys.filter((key) => !isDeepStrictEqual(before[key], after[key])).sort()
}

function overlay(base: Settings, source: Settings, keys: readonly string[]): Settings {
  const next: Record<string, unknown> = { ...base }
  for (const key of keys) {
    if (Object.hasOwn(source, key)) next[key] = source[key]
    else delete next[key]
  }
  return next
}

/**
 * The rows to insert for `change` (PLAN B1 1.3), numbered from `nextVersion`: R = change applied to the chain row in
 * force at its date; then each later chain row S, ascending, re-applied as its own delta (the keys S changed against
 * its old predecessor) on top of the new predecessor, keeping S's approval. S is not re-appended when it already holds
 * exactly that (the old row stays correct).
 */
export function rebaseTimeline(chain: readonly ChainRow[], change: TimelineChange, nextVersion: number): NewVersion[] {
  const at = change.effectiveFrom.getTime()
  const base = inForceAt(chain, change.effectiveFrom)?.settings ?? {}
  const first: NewVersion = {
    version: nextVersion, effectiveFrom: change.effectiveFrom, settings: { ...base, ...change.patch },
    approvalId: change.approvalId, reason: change.reason, rebases: null,
  }
  const rows: NewVersion[] = [first]
  let previousOld = base
  let previousNew = first.settings
  for (const later of chain.filter((row) => row.effectiveFrom.getTime() > at)) {
    const rebased = overlay(previousNew, later.settings, changedKeys(previousOld, later.settings))
    previousOld = later.settings
    previousNew = rebased
    if (isDeepStrictEqual(rebased, later.settings)) continue
    rows.push({
      version: nextVersion + rows.length, effectiveFrom: later.effectiveFrom, settings: rebased,
      approvalId: later.approvalId, reason: `Rebased v${later.version} onto v${nextVersion}: ${later.reason}`, rebases: later.id,
    })
  }
  return rows
}

/**
 * BUG-025: the start of the uninterrupted run of `key`'s current value at `at` (the earliest chain row from which the
 * value has not changed), or null when the key is unset then.
 */
export function valueSince(chain: readonly ChainRow[], key: string, at: Date): { version: number; effective_from: Date } | null {
  const upTo = chain.filter((row) => row.effectiveFrom.getTime() <= at.getTime())
  const current = upTo.at(-1)
  if (current === undefined || !Object.hasOwn(current.settings, key)) return null
  let start = current
  for (let index = upTo.length - 2; index >= 0; index -= 1) {
    const row = upTo[index]!
    if (!Object.hasOwn(row.settings, key) || !isDeepStrictEqual(row.settings[key], current.settings[key])) break
    start = row
  }
  return { version: start.version, effective_from: start.effectiveFrom }
}
