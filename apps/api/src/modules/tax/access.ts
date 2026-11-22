import type { Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope } from '../../lib/auth.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { parse } from '../../lib/http.js'
import type { Permission } from '../../lib/permissions.js'

// D-BM-14: tax rules, lines, year-end and forms are read and written by market; a market outside the caller's scope is
// answered as an unknown one (404).

export interface TaxMarket {
  id: string
  code: string
  market_pack: string
  minor_unit: number
  /** Today in the market zone (YYYY-MM-DD): the date pack rules are in force on. */
  today: string
}

export const scopeOf = (request: FastifyRequest, permission: Permission): readonly string[] | null =>
  marketScope(currentAuth(request), permission)

export const inScope = (scope: readonly string[] | null, marketId: string): boolean => scope === null || scope.includes(marketId)

/** The market by id within the caller's scope, else 404. */
export async function scopedMarket(tx: Tx, marketId: string, scope: readonly string[] | null): Promise<TaxMarket> {
  if (!inScope(scope, marketId)) throw notFound()
  const { rows } = await tx.query<TaxMarket>(
    `SELECT id, code, market_pack, minor_unit, to_char(now() AT TIME ZONE time_zone, 'YYYY-MM-DD') AS today FROM market WHERE id = $1`,
    [marketId],
  )
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

export const TAX_YEAR = z.number().int()
const TAX_YEAR_MIN = 2000
const TAX_YEAR_MAX = 2100

/** parse(), then a tax_year outside the supported range is 422 VALIDATION_FAILED {field: 'tax_year'} (TK-BM-16). */
export function parseYear<S extends z.ZodType<{ tax_year: number }>>(schema: S, value: unknown): z.infer<S> {
  const parsed = parse(schema, value)
  if (parsed.tax_year < TAX_YEAR_MIN || parsed.tax_year > TAX_YEAR_MAX) {
    throw new ApiError(422, 'VALIDATION_FAILED', `The tax year must be between ${TAX_YEAR_MIN} and ${TAX_YEAR_MAX}.`, {
      field: 'tax_year', min: TAX_YEAR_MIN, max: TAX_YEAR_MAX,
    })
  }
  return parsed
}

/** The context a tax id is sealed under: its tax-profile version (D-B4-17). */
export const sealContext = (versionId: string): string => `tax_profile:${versionId}`
