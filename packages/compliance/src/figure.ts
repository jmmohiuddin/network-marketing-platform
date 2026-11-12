import { percent } from './percent.js'
import type { Drill, DrillEntity, Figure, FigureUnit } from './types.js'

/** Identifies the R1-R5 method implemented by this package. Change it whenever any formula changes. */
export const METHOD_VERSION = 'cpl-method-1.0.0'

export const DEFAULT_DRILL_ID_CAP = 1000

export const ZERO_DENOMINATOR_NOTE = 'Not stated: the denominator is zero for this period.'

export interface FigureInput {
  readonly key: string
  readonly unit: FigureUnit
  readonly value: string | null
  readonly numerator?: bigint | null
  readonly denominator?: bigint | null
  readonly population: string
  /** Size of the population; default: the denominator set when the figure has one, otherwise the numerator set. */
  readonly populationCount?: number
  readonly method: string
  readonly note?: string | null
  readonly entity: DrillEntity
  readonly numeratorIds: readonly string[]
  readonly denominatorIds?: readonly string[]
}

export type PercentInput = Omit<FigureInput, 'unit' | 'value' | 'numerator' | 'denominator' | 'note'> & {
  readonly numerator: bigint
  readonly denominator: bigint
}

function cappedIds(ids: readonly string[], cap: number): { ids: string[]; count: number } {
  const distinct = [...new Set(ids)].sort()
  return { ids: distinct.slice(0, cap), count: distinct.length }
}

function buildDrill(input: FigureInput, cap: number): Drill {
  const numerator = cappedIds(input.numeratorIds, cap)
  const denominator = cappedIds(input.denominatorIds ?? [], cap)
  return {
    entity: input.entity,
    numeratorIds: numerator.ids,
    numeratorCount: numerator.count,
    denominatorIds: denominator.ids,
    denominatorCount: denominator.count,
  }
}

export function buildFigure(input: FigureInput, cap: number): Figure {
  const drill = buildDrill(input, cap)
  return {
    key: input.key,
    unit: input.unit,
    value: input.value,
    numerator: input.numerator ?? null,
    denominator: input.denominator ?? null,
    population: input.population,
    populationCount: input.populationCount ?? (input.denominatorIds === undefined ? drill.numeratorCount : drill.denominatorCount),
    method: input.method,
    methodVersion: METHOD_VERSION,
    note: input.note ?? null,
    drill,
  }
}

export function buildPercentFigure(input: PercentInput, cap: number): Figure {
  const value = percent(input.numerator, input.denominator)
  return buildFigure({ ...input, unit: 'percent', value, note: value === null ? ZERO_DENOMINATOR_NOTE : null }, cap)
}
