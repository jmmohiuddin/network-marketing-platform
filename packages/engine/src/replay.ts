// Replay of a committed run (FR-COMP-008, TS-03): same inputs must give the same ordered result hash.
import { inputsHash, run } from './run.js'
import type { RunInput, RunOutput } from './types.js'

export interface ReplayResult {
  readonly status: 'match' | 'inputs_differ' | 'result_differs'
  readonly inputsHash: string
  readonly resultHash: string | null // null when the inputs already differ (nothing is recalculated)
  readonly output: RunOutput | null
}

/** Compares the inputs hash first, then recalculates and compares the result hash. */
export function replay(input: RunInput, committed: { readonly inputsHash: string; readonly resultHash: string }): ReplayResult {
  const hash = inputsHash(input)
  if (hash !== committed.inputsHash) return { status: 'inputs_differ', inputsHash: hash, resultHash: null, output: null }
  const output = run(input)
  return { status: output.resultHash === committed.resultHash ? 'match' : 'result_differs', inputsHash: hash, resultHash: output.resultHash, output }
}
