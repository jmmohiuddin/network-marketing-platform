// Every engine failure is an EngineError: the orchestrator marks the run failed with code + details (SDD-07 §7).
export type EngineErrorCode =
  | 'INVALID_INPUT' // snapshot or plan data the engine cannot calculate on (unknown id, malformed decimal, ...)
  | 'TREE' // as-of tree is not a forest: two parents, unknown position, cycle (FR-GEN-002)
  | 'OVERFLOW' // a value left the signed 64-bit range of amount_minor (FR-COMP-012)
  | 'INVARIANT' // a pass-12 invariant failed (TR-ENG-16); nothing is committable

export class EngineError extends Error {
  constructor(readonly code: EngineErrorCode, message: string, readonly details: Readonly<Record<string, string>> = {}) {
    super(`${code}: ${message}`)
    this.name = 'EngineError'
  }
}
