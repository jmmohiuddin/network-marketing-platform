import type { Tx } from '@nmp/db'
import { formatUnits } from '@nmp/engine'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { toCsv } from '../../lib/csv.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { recordExport } from '../../lib/exports.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { open } from '../../lib/secret-box.js'
import { parseYear, scopedMarket, scopeOf, sealContext, TAX_YEAR } from './access.js'
import { formCsv, sendFormCsv, type FormTotals } from './forms.js'

// D-BM-06 / FR-TAX-003 (API-36): the year-end preview, generation of frozen form versions (SQL tax_generate_forms, the
// only writer), the generations and forms of a market's tax year, form downloads and the filing export with full tax ids.

const yearFields = { market_id: z.uuid(), tax_year: z.coerce.number().pipe(TAX_YEAR) }
const yearQuery = z.strictObject({ ...yearFields, ...pageQuery })
const generationsQuery = z.strictObject(yearFields)
const formsQuery = z.strictObject({ ...yearFields, participant_id: z.uuid().optional(), ...pageQuery })
const yearBody = z.strictObject({ market_id: z.uuid(), tax_year: TAX_YEAR })
const idParams = z.strictObject({ id: z.uuid() })
const refCursor = z.tuple([z.string(), z.uuid()])

const REFUSALS: Readonly<Record<string, string>> = {
  TAX_YEAR_NOT_DEFINED: "The market's pack defines no tax year.",
  FORM_NOT_DEFINED: "The market's pack defines no year-end form for this tax year.",
  TAX_YEAR_NOT_ENDED: "The tax year has not ended yet in the market's time zone.",
  TAX_YEAR_NOT_CLOSED: 'A period of the tax year is committed or paid but not closed, or has a run waiting to be committed.',
}

interface PayeeRow {
  participant_id: string
  payee_ref: string
  gross_minor: string
  taxable_minor: string
  withheld_minor: string
  has_tax_id: boolean
  included: boolean
  latest_version: number | null
}

interface Generation {
  generation_id: string
  generated: number
  unchanged: number
  held: { participant_id: string; payee_ref: string }[]
}

interface ExportRow {
  payee_ref: string
  form_type: string
  version: number
  currency: string
  totals: FormTotals
  profile_id: string | null
  tax_id_sealed: string | null
}

/** The latest form version per payee and form type of a market's tax year ($1 market, $2 year, $3 participant or NULL). */
const LATEST = `SELECT DISTINCT ON (participant_id, form_type) * FROM tax_form
  WHERE market_id = $1 AND tax_year = $2 AND ($3::uuid IS NULL OR participant_id = $3)
  ORDER BY participant_id, form_type, version DESC`

/** tax_generate_forms refusals: TX001 {code, period_ids?} -> 422 code, TX002 -> 409 busy, the ledger check -> 500. */
function generationError(error: unknown): unknown {
  const { code, detail } = error as { code?: string; detail?: string }
  if (code === 'TX001' && detail !== undefined) {
    const { code: reason, ...details } = JSON.parse(detail) as { code: string; period_ids?: string[] }
    return new ApiError(422, reason, REFUSALS[reason] ?? 'Year-end forms cannot be generated.', Object.keys(details).length > 0 ? details : null)
  }
  if (code === 'TX002') return new ApiError(409, 'GENERATION_BUSY', 'These forms are being generated right now. Try again in a moment.')
  if (code === '23514') return new ApiError(500, 'INVARIANT_FAILED', 'The withheld totals differ from the ledger. Nothing was generated.')
  return error
}

async function generateForms(tx: Tx, marketId: string, taxYear: number): Promise<Generation> {
  try {
    const { rows } = await tx.query<{ result: Generation }>('SELECT tax_generate_forms($1, $2) AS result', [marketId, taxYear])
    return rows[0]!.result
  } catch (error) {
    throw generationError(error)
  }
}

/** AC-TAX3-3: the latest version per payee with the full tax id of the profile version in force when the form was made. */
async function exportCsv(tx: Tx, request: FastifyRequest, body: z.infer<typeof yearBody>): Promise<{ csv: string } | { refused: { rowCount: number; rowCap: number } }> {
  const { config } = request.server
  const market = await scopedMarket(tx, body.market_id, scopeOf(request, 'tax.forms'))
  const { rows } = await tx.query<ExportRow>(
    `SELECT f.payee_ref, f.form_type, f.version, f.currency, f.totals, tp.id AS profile_id, tp.tax_id_sealed
     FROM (${LATEST}) f
     LEFT JOIN tax_profile tp ON tp.participant_id = f.participant_id AND tp.valid_from <= f.created_at
       AND (tp.valid_to IS NULL OR tp.valid_to > f.created_at)
     ORDER BY f.payee_ref, f.form_type`,
    [market.id, body.tax_year, null],
  )
  if (rows.length === 0) throw new ApiError(422, 'NO_FORMS', 'No year-end forms were generated for this market and tax year.')
  const decision = await recordExport(tx, { kind: 'tax_forms', filters: { ...body }, rowCount: rows.length, rowCap: config.exportRowCap })
  if (decision.refused) return { refused: decision }
  await recordAudit(tx, {
    action: 'TAX_FORMS.EXPORTED', objectType: 'export_job', objectId: decision.job.id,
    after: { market_id: market.id, tax_year: body.tax_year, rows: rows.length },
  })
  const amount = (minor: string) => formatUnits(BigInt(minor), market.minor_unit)
  // An erased payee's profile keeps no tax id (prv_erase_participant): the cell stays empty.
  const lines = rows.map((row) => [
    row.payee_ref, row.tax_id_sealed === null ? null : open(config.secretKey, row.tax_id_sealed, sealContext(row.profile_id!)),
    row.tax_id_sealed === null ? 'erased' : 'present', row.form_type, row.version, row.currency,
    amount(row.totals.gross_minor), amount(row.totals.taxable_minor), amount(row.totals.withheld_minor),
  ])
  const header = ['payee_ref', 'tax_id', 'tax_id_status', 'form_type', 'version', 'currency', 'gross', 'taxable', 'withheld']
  return { csv: toCsv(header, lines) }
}

export function registerYearEndRoutes(app: FastifyInstance): void {
  const read = { preHandler: [requireRealm('tenant'), requirePermission('tax.read')] }
  const forms = { preHandler: [requireRealm('tenant'), requirePermission('tax.forms'), requireStepUp()] }

  app.get('/v1/tax/year-end', read, async (request) => {
    const { market_id: marketId, tax_year: taxYear, cursor, limit } = parseYear(yearQuery, request.query)
    const after = decodeCursor(cursor, refCursor)
    return inTenant(request, async (tx) => {
      await scopedMarket(tx, marketId, scopeOf(request, 'tax.read'))
      const { rows: status } = await tx.query<{ status: Record<string, unknown> }>('SELECT tax_year_end_status($1, $2) AS status', [marketId, taxYear])
      const { rows } = await tx.query<PayeeRow>(
        `SELECT t.participant_id, t.payee_ref, t.gross_minor::text AS gross_minor, t.taxable_minor::text AS taxable_minor,
                t.withheld_minor::text AS withheld_minor, t.has_tax_id, t.included, t.latest_version
         FROM tax_year_end_totals($1, $2) t
         WHERE $3::text IS NULL OR (t.payee_ref, t.participant_id) > ($3::text, $4::uuid)
         ORDER BY t.payee_ref, t.participant_id LIMIT $5`,
        [marketId, taxYear, after?.[0] ?? null, after?.[1] ?? null, limit + 1],
      )
      const page = toPage(rows, limit, (row) => [row.payee_ref, row.participant_id])
      const payees = page.data.map((row) => ({
        participant: { id: row.participant_id, external_ref: row.payee_ref }, gross_minor: row.gross_minor, taxable_minor: row.taxable_minor,
        withheld_minor: row.withheld_minor, tax_id: row.has_tax_id ? 'present' : 'missing', included: row.included, latest_version: row.latest_version,
      }))
      return envelope({ ...status[0]!.status, payees }, page.meta)
    })
  })

  app.post('/v1/tax/year-end-forms', forms, async (request, reply) => {
    const body = parseYear(yearBody, request.body)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const market = await scopedMarket(tx, body.market_id, scopeOf(request, 'tax.forms'))
      const generation = await generateForms(tx, market.id, body.tax_year)
      await recordAudit(tx, {
        action: 'TAX_FORMS.GENERATED', objectType: 'tax_form_generation', objectId: generation.generation_id,
        after: {
          generation_id: generation.generation_id, market_id: market.id, tax_year: body.tax_year, generated: generation.generated,
          unchanged: generation.unchanged, held_count: generation.held.length,
        },
      })
      return {
        statusCode: 201,
        body: envelope({
          generation_id: generation.generation_id, generated: generation.generated, unchanged: generation.unchanged,
          held: generation.held.map((held) => ({ participant_id: held.participant_id, external_ref: held.payee_ref })),
        }),
      }
    }))
    return sendIdempotent(reply, result)
  })

  app.get('/v1/tax/year-end-generations', read, async (request) => {
    const { market_id: marketId, tax_year: taxYear } = parseYear(generationsQuery, request.query)
    return inTenant(request, async (tx) => {
      await scopedMarket(tx, marketId, scopeOf(request, 'tax.read'))
      const { rows } = await tx.query(
        `SELECT g.id, g.form_type, g.generated, g.unchanged,
                (SELECT coalesce(jsonb_agg(jsonb_build_object('participant_id', h.item ->> 'participant_id', 'external_ref', h.item ->> 'payee_ref')
                                           ORDER BY h.n), '[]')
                 FROM jsonb_array_elements(g.held) WITH ORDINALITY AS h (item, n)) AS held,
                g.withheld_total_minor::text AS withheld_total_minor,
                jsonb_build_object('id', g.created_by, 'display_name', u.display_name) AS created_by, g.created_at
         FROM tax_form_generation g JOIN user_account u ON u.id = g.created_by
         WHERE g.market_id = $1 AND g.tax_year = $2 ORDER BY g.created_at DESC, g.id DESC`,
        [marketId, taxYear],
      )
      return envelope(rows)
    })
  })

  app.get('/v1/tax/year-end-forms', read, async (request) => {
    const { market_id: marketId, tax_year: taxYear, participant_id: participantId, cursor, limit } = parseYear(formsQuery, request.query)
    const after = decodeCursor(cursor, refCursor)
    return inTenant(request, async (tx) => {
      await scopedMarket(tx, marketId, scopeOf(request, 'tax.read'))
      const { rows } = await tx.query<{ id: string; participant: { external_ref: string } }>(
        `SELECT f.id, jsonb_build_object('id', f.participant_id, 'external_ref', f.payee_ref) AS participant, f.form_type, f.version,
                (SELECT count(*)::int FROM tax_form v
                 WHERE v.participant_id = f.participant_id AND v.tax_year = f.tax_year AND v.form_type = f.form_type) AS versions,
                f.tax_id_masked, f.currency, f.totals, f.created_at
         FROM (${LATEST}) f
         WHERE $4::text IS NULL OR (f.payee_ref, f.id) > ($4::text, $5::uuid)
         ORDER BY f.payee_ref, f.id LIMIT $6`,
        [marketId, taxYear, participantId ?? null, after?.[0] ?? null, after?.[1] ?? null, limit + 1],
      )
      return toPage(rows, limit, (row) => [row.participant.external_ref, row.id])
    })
  })

  app.get('/v1/tax/year-end-forms/:id/download', read, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    return sendFormCsv(reply, await inTenant(request, (tx) => formCsv(tx, id, scopeOf(request, 'tax.read'), null)))
  })

  // A refused export is committed (EXPORT.REFUSED is audited), so it is sent, not thrown.
  app.post('/v1/tax/year-end-forms/export', forms, async (request, reply) => {
    const body = parseYear(yearBody, request.body)
    const file = await inTenant(request, (tx) => exportCsv(tx, request, body))
    reply.header('cache-control', 'no-store')
    if ('refused' in file) {
      return reply.code(422).send({ error: {
        code: 'EXPORT_ROW_CAP_EXCEEDED', message: 'The export is larger than the row limit.',
        details: { row_count: file.refused.rowCount, row_cap: file.refused.rowCap }, request_id: request.id,
      } })
    }
    reply.header('content-type', 'text/csv; charset=utf-8')
    reply.header('content-disposition', `attachment; filename="tax-forms-${body.market_id}-${body.tax_year}.csv"`)
    return reply.send(file.csv)
  })
}
