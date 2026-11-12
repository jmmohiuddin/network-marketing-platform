import { describe, expect, it } from 'vitest'
import { draftFrom, toMappings, unmappedCodes } from './mapping-model'
import type { Mappings, SourceValues } from './types'

const VERSION: Mappings = {
  participant_types: { distributor: { can_earn: true, counts_as_end_customer: false } },
  purposes: { P: 'personal' },
  source_kinds: {},
  starter_kits: {},
}
const BATCH: SourceValues = {
  participant_types: { distributor: 4, constructor: 1 },
  purposes: { P: 3, R: 2 },
  source_kinds: { DL: 5 },
  starter_kits: { '0': 3, Y: 1 },
}

describe('mapping model', () => {
  it('lists every code of the version and the batch, never reading Object.prototype', () => {
    const draft = draftFrom(VERSION, BATCH)
    expect(draft.participant_types).toEqual({
      constructor: { can_earn: '', counts_as_end_customer: '' },
      distributor: { can_earn: 'yes', counts_as_end_customer: 'no' },
    })
    expect(draft.purposes).toEqual({ P: 'personal', R: '' })
    expect(draft.starter_kits).toEqual({ '0': '', Y: '' })
  })

  it('reports unmapped codes: unknown for purposes and kinds, blocking for types and non-published kit codes', () => {
    expect(unmappedCodes(draftFrom(VERSION, BATCH))).toEqual({ unknown: ['R', 'DL'], blocking: ['constructor', 'Y'] })
  })

  it('leaves unmapped codes out of the saved mappings and refuses half-answered participant types', () => {
    const draft = draftFrom(VERSION, BATCH)
    const edited = {
      ...draft,
      participant_types: { ...draft.participant_types, constructor: { can_earn: 'no', counts_as_end_customer: '' } },
      starter_kits: { ...draft.starter_kits, Y: 'yes' },
      source_kinds: { DL: 'downline_volume' },
    } as const
    const { mappings, problems } = toMappings(edited)
    expect(problems).toHaveLength(1)
    expect(mappings).toEqual({
      participant_types: { distributor: { can_earn: true, counts_as_end_customer: false } },
      purposes: { P: 'personal' },
      source_kinds: { DL: 'downline_volume' },
      starter_kits: { Y: true },
    })
  })
})
