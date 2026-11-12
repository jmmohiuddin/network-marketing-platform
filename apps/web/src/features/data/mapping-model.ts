import type { Mappings, ParticipantFlags, Purpose, SourceKind, SourceValues } from './types'

/** '' = not mapped. */
export type Choice = '' | 'yes' | 'no'

export interface ParticipantChoice {
  readonly can_earn: Choice
  readonly counts_as_end_customer: Choice
}

/** The editable form of a mapping: every code of the version and of the batch, each with its choice. */
export interface Draft {
  readonly participant_types: Readonly<Record<string, ParticipantChoice>>
  readonly purposes: Readonly<Record<string, Purpose | ''>>
  readonly source_kinds: Readonly<Record<string, SourceKind | ''>>
  readonly starter_kits: Readonly<Record<string, Choice>>
}

/** is_starter_kit codes with a published meaning when the mapping does not name them (MVP_A 3.1). */
export const PUBLISHED_STARTER_KIT_CODES: ReadonlySet<string> = new Set(['', '0', '1'])

// Partner codes are data: 'constructor' or '__proto__' must never hit Object.prototype.
const own = <V>(record: Readonly<Record<string, V>> | undefined, code: string): V | undefined =>
  record !== undefined && Object.hasOwn(record, code) ? record[code] : undefined

function codesOf(mapped: object | undefined, values: Readonly<Record<string, number>> | undefined): string[] {
  return [...new Set([...Object.keys(mapped ?? {}), ...Object.keys(values ?? {})])].sort()
}

const yesNo = (value: boolean): Choice => (value ? 'yes' : 'no')

function choices<V, C>(mapped: Readonly<Record<string, V>> | undefined, values: Readonly<Record<string, number>> | undefined, choose: (value: V | undefined) => C): Record<string, C> {
  return Object.fromEntries(codesOf(mapped, values).map((code) => [code, choose(own(mapped, code))]))
}

/** Seeds the form from a version (null for the first one) and the batch's partner codes (null without a batch). */
export function draftFrom(mappings: Mappings | null, values: SourceValues | null): Draft {
  const participantChoice = (flags: ParticipantFlags | undefined): ParticipantChoice =>
    flags === undefined
      ? { can_earn: '', counts_as_end_customer: '' }
      : { can_earn: yesNo(flags.can_earn), counts_as_end_customer: yesNo(flags.counts_as_end_customer) }
  return {
    participant_types: choices(mappings?.participant_types, values?.participant_types, participantChoice),
    purposes: choices(mappings?.purposes, values?.purposes, (purpose) => purpose ?? ''),
    source_kinds: choices(mappings?.source_kinds, values?.source_kinds, (kind) => kind ?? ''),
    starter_kits: choices(mappings?.starter_kits, values?.starter_kits, (kit) => (kit === undefined ? '' : yesNo(kit))),
  }
}

const mapped = <V>(record: Readonly<Record<string, V | ''>>): Record<string, V> =>
  Object.fromEntries(Object.entries(record).filter((entry): entry is [string, V] => entry[1] !== ''))

/** The PUT body's mappings: unmapped codes are left out (purposes and source kinds then load as unknown). */
export function toMappings(draft: Draft): { readonly mappings: Mappings; readonly problems: readonly string[] } {
  const problems = Object.entries(draft.participant_types)
    .filter(([, choice]) => (choice.can_earn === '') !== (choice.counts_as_end_customer === ''))
    .map(([code]) => `Answer both questions for participant type "${code}", or neither to leave it unmapped.`)
  const participantTypes = Object.entries(draft.participant_types)
    .filter(([, choice]) => choice.can_earn !== '' && choice.counts_as_end_customer !== '')
    .map(([code, choice]) => [code, { can_earn: choice.can_earn === 'yes', counts_as_end_customer: choice.counts_as_end_customer === 'yes' }] as const)
  return {
    problems,
    mappings: {
      participant_types: Object.fromEntries(participantTypes),
      purposes: mapped(draft.purposes),
      source_kinds: mapped(draft.source_kinds),
      starter_kits: Object.fromEntries(Object.entries(mapped(draft.starter_kits)).map(([code, kit]) => [code, kit === 'yes'])),
    },
  }
}

export interface Unmapped {
  /** Order purposes and payout source kinds that will load as unknown. */
  readonly unknown: readonly string[]
  /** Participant types and starter-kit codes without a meaning: a batch using them cannot be loaded. */
  readonly blocking: readonly string[]
}

export function unmappedCodes(draft: Draft): Unmapped {
  const empty = (record: Readonly<Record<string, string>>) => Object.keys(record).filter((code) => record[code] === '')
  return {
    unknown: [...empty(draft.purposes), ...empty(draft.source_kinds)],
    blocking: [
      ...Object.keys(draft.participant_types).filter((code) => draft.participant_types[code]!.can_earn === '' || draft.participant_types[code]!.counts_as_end_customer === ''),
      ...empty(draft.starter_kits).filter((code) => !PUBLISHED_STARTER_KIT_CODES.has(code)),
    ],
  }
}
