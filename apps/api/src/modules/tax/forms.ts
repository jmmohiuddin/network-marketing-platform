import type { Tx } from '@nmp/db'
import { formatUnits } from '@nmp/engine'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, requirePortal } from '../../lib/auth.js'
import { toCsv } from '../../lib/csv.js'
import { inPortal } from '../../lib/db.js'
import { notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { inScope } from './access.js'

// D-BM-06 (C-BM-1): a year-end form is its frozen tax_form row, rendered on read as a label,value CSV statement under the
// title of the pack's form rule in force on the tax year's last day (the rule the generation used; rules are immutable).
// The payee lists its own forms and downloads any own version in the portal (AC-TAX3-4).

export interface FormTotals {
  gross_minor: string
  taxable_minor: string
  withheld_minor: string
  by_rule: { rule_id: string; rate: string; taxable_minor: string; withheld_minor: string }[]
  period_ids: string[]
}

interface FormRow {
  id: string
  market_id: string
  tax_year: number
  form_type: string
  version: number
  payee_ref: string
  tax_id_masked: string
  currency: string
  totals: FormTotals
  created_at: Date
  minor_unit: number
  title: string | null
}

/**
 * The rule title of a form's year when that rule still defines the form's type (portal sessions read platform pack data
 * too); another form type gives no title rather than another rule's.
 * shortcut: read from the pack rule now in force for the year, not the generation's rule_id (portal_hidden hides
 * tax_form_generation from portal sessions); a later rule of the same form type retitles old forms. Upgrade when a pack
 * gains a second year_end_form version: freeze the title on tax_form at generation (DB agent, 07xx).
 */
export const FORM_TITLE = `(SELECT r.conditions ->> 'title' FROM tax_year_end_form_rule(f.market_id, f.tax_year) r
                            WHERE r.conditions ->> 'form_type' = f.form_type)`

export interface FormFile {
  readonly csv: string
  readonly name: string
}

/**
 * The form as a CSV statement; 404 when it is not visible, outside `scope`, or (participantId given) not that payee's.
 * Every download is audited TAX_FORM.DOWNLOADED.
 */
export async function formCsv(tx: Tx, formId: string, scope: readonly string[] | null, participantId: string | null): Promise<FormFile> {
  const { rows } = await tx.query<FormRow>(
    `SELECT f.id, f.market_id, f.tax_year, f.form_type, f.version, f.payee_ref, f.tax_id_masked, f.currency, f.totals, f.created_at,
            m.minor_unit, ${FORM_TITLE} AS title
     FROM tax_form f JOIN market m ON m.id = f.market_id
     WHERE f.id = $1 AND ($2::uuid IS NULL OR f.participant_id = $2)`,
    [formId, participantId],
  )
  const form = rows[0]
  if (form === undefined || !inScope(scope, form.market_id)) throw notFound()
  const amount = (minor: string) => formatUnits(BigInt(minor), form.minor_unit)
  const { totals } = form
  const lines: unknown[][] = [
    ['title', form.title], ['tax_year', form.tax_year], ['form_type', form.form_type], ['version', form.version],
    ['payee_ref', form.payee_ref], ['tax_id', form.tax_id_masked], ['currency', form.currency], ['issued_at', form.created_at],
    ['gross', amount(totals.gross_minor)], ['taxable', amount(totals.taxable_minor)], ['withheld', amount(totals.withheld_minor)],
    ...totals.by_rule.flatMap((rule, index) => [
      [`rule_${index + 1}_id`, rule.rule_id], [`rule_${index + 1}_rate`, rule.rate],
      [`rule_${index + 1}_taxable`, amount(rule.taxable_minor)], [`rule_${index + 1}_withheld`, amount(rule.withheld_minor)],
    ]),
  ]
  await recordAudit(tx, { action: 'TAX_FORM.DOWNLOADED', objectType: 'tax_form', objectId: form.id, after: { form_id: form.id } })
  return { csv: toCsv(['label', 'value'], lines), name: `${form.form_type}-${form.tax_year}-v${form.version}.csv` }
}

export function sendFormCsv(reply: FastifyReply, file: FormFile): FastifyReply {
  reply.header('content-type', 'text/csv; charset=utf-8')
  reply.header('content-disposition', `attachment; filename="${file.name}"`)
  reply.header('cache-control', 'no-store')
  return reply.send(file.csv)
}

const idParams = z.strictObject({ id: z.uuid() })

export function registerPortalFormRoutes(app: FastifyInstance): void {
  const portal = { preHandler: [requirePortal()] }

  // The latest version per tax year and form type; the portal_self policy is the backstop of the participant filter.
  app.get('/v1/me/tax-forms', portal, async (request) => {
    const participantId = currentAuth(request).participantId!
    const { rows } = await inPortal(request, (tx) => tx.query(
      `SELECT f.id, f.tax_year, f.form_type, ${FORM_TITLE} AS title, f.version, f.currency,
              jsonb_build_object('gross_minor', f.totals ->> 'gross_minor', 'taxable_minor', f.totals ->> 'taxable_minor',
                                 'withheld_minor', f.totals ->> 'withheld_minor') AS totals, f.created_at
       FROM (SELECT DISTINCT ON (tax_year, form_type) * FROM tax_form WHERE participant_id = $1
             ORDER BY tax_year, form_type, version DESC) f
       ORDER BY f.tax_year DESC, f.form_type`,
      [participantId],
    ))
    return envelope(rows)
  })

  app.get('/v1/me/tax-forms/:id/download', portal, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const participantId = currentAuth(request).participantId!
    return sendFormCsv(reply, await inPortal(request, (tx) => formCsv(tx, id, null, participantId)))
  })
}
