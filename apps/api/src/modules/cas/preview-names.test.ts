import type { Tx } from '@nmp/db'
import { describe, expect, test } from 'vitest'
import { withCurrentNames } from './cases.js'

const ERASED = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const LIVE = '9b2f8c1e-1d4a-4f3b-8c2d-5e6f7a8b9c0d'

// par_display as the database answers after ERASED's erasure: the row stays, its name is NULL.
const fakeTx = (queried: unknown[][]) => ({
  query: async (_sql: string, params: unknown[]) => {
    queried.push(params)
    return { rows: [{ participant_id: ERASED, display_name: null }, { participant_id: LIVE, display_name: 'Bea Live' }] }
  },
}) as unknown as Tx

describe('withCurrentNames (BUG-109)', () => {
  test("fills each ref's display_name with the current name (null once erased), also over a name stored before the fix", async () => {
    const records = [
      { id: 'c1', effect_preview: { payee: { id: ERASED, external_ref: 'DE-A', display_name: 'DE-A' }, market: { id: LIVE, code: 'DE' } } },
      { id: 'c2', effect_preview: { instruction: { participant: { id: LIVE, external_ref: 'DE-B', display_name: null } }, lines: [{ id: ERASED, external_ref: 'DE-A', display_name: null }] } },
    ]
    const before = structuredClone(records)
    const queried: unknown[][] = []
    const viewed = await withCurrentNames(fakeTx(queried), records)
    expect(queried).toEqual([[[ERASED, LIVE]]])
    expect(viewed).toEqual([
      { id: 'c1', effect_preview: { payee: { id: ERASED, external_ref: 'DE-A', display_name: null }, market: { id: LIVE, code: 'DE' } } },
      { id: 'c2', effect_preview: { instruction: { participant: { id: LIVE, external_ref: 'DE-B', display_name: 'Bea Live' } }, lines: [{ id: ERASED, external_ref: 'DE-A', display_name: null }] } },
    ])
    expect(records).toEqual(before) // inputs are not mutated
  })

  test('refs without a display_name key and non-uuid ids are left as stored, without a query', async () => {
    const queried: unknown[][] = []
    const records = [
      { effect_preview: null },
      { effect_preview: { subject: { id: ERASED, external_ref: 'DE-A' } } }, // the privacy subject carries no display_name key
      { effect_preview: { payee: { id: 'not-a-uuid', external_ref: 'X', display_name: null } } },
    ]
    expect(await withCurrentNames(fakeTx(queried), records)).toEqual(records)
    expect(queried).toEqual([])
  })
})
