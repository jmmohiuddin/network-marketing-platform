import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, requireAnyPermission, requirePermission, requireRealm, scopeOfAny } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import type { Permission } from '../../lib/permissions.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { inScope, scopedMarket, scopeOf } from './access.js'

// AC-TAX2-4 (API-39 read): the pack's withholding and year-end form rules (every version, in force today in the market
// zone flagged), its tax year and tax-id format; a run's withholding lines with their totals. Rates are 6-dp strings.

const BASIS = `basis, basis_status, source_ref, reviewed_by, to_char(reviewed_at, 'YYYY-MM-DD') AS reviewed_at,
  to_char(effective_from, 'YYYY-MM-DD') AS effective_from, to_char(effective_to, 'YYYY-MM-DD') AS effective_to`

interface BasisFields {
  basis: string
  basis_status: string
  source_ref: string
  reviewed_by: string | null
  reviewed_at: string | null
  effective_from: string
  effective_to: string | null
}

interface TaxRuleRow extends BasisFields {
  kind: 'withholding' | 'year_end_form'
  id: string
  title: string
  conditions: Record<string, unknown>
  rate: string | null
  threshold_minor: string | null
  threshold_basis: string | null
  missing_id_rate: string | null
  rounding: string
  in_force: boolean
}

interface PackRuleRow extends BasisFields {
  kind: 'tax_year' | 'tax_id_format'
  id: string
  params: Record<string, unknown>
}

interface LineRow {
  id: string
  payee: { id: string; external_ref: string }
  rule_id: string
  rate: string
  rate_basis: string
  taxable_minor: string
  withheld_minor: string
  tax_year: number
  tax_date: string
}

const marketQuery = z.strictObject({ market_id: z.uuid() })
const linesQuery = z.strictObject({ run_id: z.uuid(), ...pageQuery })
const lineCursor = z.tuple([z.string(), z.uuid()])

const basisOf = (row: BasisFields): BasisFields => ({
  basis: row.basis, basis_status: row.basis_status, source_ref: row.source_ref, reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at,
  effective_from: row.effective_from, effective_to: row.effective_to,
})

// A year-end form rule has no rate, threshold or rounding (always 'none'); its form lives in the conditions.
const yearEndForm = (rule: TaxRuleRow) => ({
  id: rule.id, form_type: rule.conditions.form_type, title: rule.conditions.title, min_gross_minor: rule.conditions.min_gross_minor ?? null,
  ...basisOf(rule), in_force: rule.in_force,
})

export function registerTaxRuleRoutes(app: FastifyInstance): void {
  const read = { preHandler: [requireRealm('tenant'), requirePermission('tax.read')] }

  app.get('/v1/tax/rules', read, async (request) => {
    const { market_id: marketId } = parse(marketQuery, request.query)
    return inTenant(request, async (tx) => {
      const market = await scopedMarket(tx, marketId, scopeOf(request, 'tax.read'))
      const { rows: taxRules } = await tx.query<TaxRuleRow>(
        `SELECT kind, id, title, conditions, rate::text AS rate, threshold_minor::text AS threshold_minor, threshold_basis,
                missing_id_rate::text AS missing_id_rate, rounding, ${BASIS},
                effective_from <= $2::date AND (effective_to IS NULL OR effective_to > $2::date) AS in_force
         FROM tax_rule WHERE market_pack = $1 ORDER BY effective_from DESC, id`,
        [market.market_pack, market.today],
      )
      const { rows: packRules } = await tx.query<PackRuleRow>(
        `SELECT r.kind, r.id, r.params, ${BASIS}
         FROM unnest(ARRAY['tax_year', 'tax_id_format']) AS k (kind)
         CROSS JOIN LATERAL market_pack_rule($1, k.kind, $2::date) r
         WHERE r.id IS NOT NULL`,
        [market.id, market.today],
      )
      const packRule = (kind: PackRuleRow['kind']) => {
        const rule = packRules.find((row) => row.kind === kind)
        if (rule === undefined) return null
        return { id: rule.id, ...rule.params, ...basisOf(rule) }
      }
      return envelope({
        market: { id: market.id, code: market.code, market_pack: market.market_pack },
        withholding: taxRules.filter((rule) => rule.kind === 'withholding').map(({ kind: _kind, ...rule }) => rule),
        year_end_forms: taxRules.filter((rule) => rule.kind === 'year_end_form').map(yearEndForm),
        tax_year: packRule('tax_year'),
        tax_id_format: packRule('tax_id_format'),
      })
    })
  })

  // BUG-131: the run reviewer (run.review) sees the run's withholding on SC-02 review, as it sees the run's amounts.
  const lineReaders: Permission[] = ['tax.read', 'run.review']
  app.get('/v1/tax/lines', { preHandler: [requireRealm('tenant'), requireAnyPermission(...lineReaders)] }, async (request) => {
    const { run_id: runId, cursor, limit } = parse(linesQuery, request.query)
    const after = decodeCursor(cursor, lineCursor)
    return inTenant(request, async (tx) => {
      const { rows: runs } = await tx.query<{ id: string; state: string; period_id: string; market_id: string }>(
        `SELECT r.id, r.state, r.period_id, c.market_id FROM run r
         JOIN period p ON p.id = r.period_id JOIN calendar c ON c.id = p.calendar_id WHERE r.id = $1`,
        [runId],
      )
      const run = runs[0]
      if (run === undefined || !inScope(scopeOfAny(currentAuth(request), lineReaders), run.market_id)) throw notFound()
      const { rows } = await tx.query<LineRow>(
        `SELECT l.id, jsonb_build_object('id', x.id, 'external_ref', x.external_ref) AS payee, l.rule_id, l.rate::text AS rate, l.rate_basis,
                l.taxable_minor::text AS taxable_minor, l.withheld_minor::text AS withheld_minor, l.tax_year,
                to_char(l.tax_date, 'YYYY-MM-DD') AS tax_date
         FROM tax_line l JOIN participant x ON x.id = l.payee_participant_id
         WHERE l.run_id = $1 AND ($2::text IS NULL OR (x.external_ref, l.id) > ($2::text, $3::uuid))
         ORDER BY x.external_ref, l.id LIMIT $4`,
        [runId, after?.[0] ?? null, after?.[1] ?? null, limit + 1],
      )
      const { rows: totals } = await tx.query<{ taxable_minor: string; withheld_minor: string }>(
        `SELECT coalesce(sum(taxable_minor), 0)::text AS taxable_minor, coalesce(sum(withheld_minor), 0)::text AS withheld_minor
         FROM tax_line WHERE run_id = $1`,
        [runId],
      )
      const page = toPage(rows, limit, (line) => [line.payee.external_ref, line.id])
      return envelope(page.data, { ...page.meta, totals: totals[0]!, run: { id: run.id, state: run.state, period_id: run.period_id } })
    })
  })
}
