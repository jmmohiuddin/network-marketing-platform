// Golden fixtures (generated from verify_calculations.py scenarios; money as strings). Fields ending in
// `Minor` or `Us` (or arrays under such keys) become bigint, matching the src/types.ts convention.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LadderRank, MeasureValue, RunInput } from '../../src/types.js'

const BIGINT_KEY = /(Minor|Us)$/

export function loadFixture<T>(file: string): T {
  const text = readFileSync(join(import.meta.dirname, file), 'utf8')
  return JSON.parse(text, (key, value: unknown) => {
    if (!BIGINT_KEY.test(key)) return value
    if (typeof value === 'string') return BigInt(value)
    if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? BigInt(v) : v))
    return value
  }) as T
}

export interface ExpectedLine { readonly payeePositionId: string; readonly ruleKey: string; readonly amountMinor: bigint }
/** Every key is optional; `lines`, when present, is the complete set of non-zero result lines. */
export interface RunExpected {
  readonly lines?: readonly ExpectedLine[]
  readonly positions?: readonly { readonly positionId: string; readonly measures: readonly MeasureValue[]; readonly paidAs: readonly LadderRank[] }[]
  readonly caps?: readonly { readonly capKey: string; readonly bound: boolean; readonly baseMinor: bigint; readonly capMinor: bigint; readonly proposedMinor: bigint }[]
  readonly payees?: readonly Readonly<Record<string, string | bigint>>[]
  readonly controlTotals?: Readonly<Record<string, bigint>>
}
export interface RunCase { readonly name: string; readonly input: RunInput; readonly expected: RunExpected }
export interface RunFixture { readonly id: string; readonly release: string; readonly owner: string; readonly description: string; readonly cases: readonly RunCase[] }

/** Fixtures whose cases are whole runs (RunInput -> expected output subset). */
export const RUN_FIXTURES = [
  'g-e2e-01.json', 'ts01-unilevel.json', 'ts02-compression.json', 'ts06-pool.json', 'ts10-refund.json',
  'ts11-netting.json', 'ts12-fast-start.json', 'ts22-multi-position.json', 'ts38-withholding.json',
] as const
