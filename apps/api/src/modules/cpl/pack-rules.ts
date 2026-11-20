import type { Tx } from '@nmp/db'

export interface PackRule {
  kind: 'guardrail' | 'tax' | 'grievance_register' | 'delisted_register' | 'plan_filing' | 'tax_year' | 'tax_id_format'
  id: string
  title: string
  mandatory: boolean
  basis: string
  basis_status: 'screening' | 'primary_read' | 'counsel_confirmed'
  source_ref: string
  reviewed_by: string | null
  /** YYYY-MM-DD */
  reviewed_at: string | null
  effective_from: string
  effective_to: string | null
}

/**
 * FR-CPL-012: the rules of a market pack in force on a date (YYYY-MM-DD), each with its basis and basis status.
 * Pack rules are platform data (no tenant), maintained by migrations only.
 */
export async function packRules(tx: Tx, pack: string, on: string): Promise<PackRule[]> {
  const { rows } = await tx.query<PackRule>(
    `SELECT kind, id, title, mandatory, basis, basis_status, source_ref, reviewed_by,
            to_char(reviewed_at, 'YYYY-MM-DD') AS reviewed_at, to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(effective_to, 'YYYY-MM-DD') AS effective_to
     FROM market_pack_rules($1, $2::date)`,
    [pack, on],
  )
  return rows
}

/** Mandatory rules still at basis status screening: a market on this pack needs a written risk acceptance to go live. */
export const screeningMandatory = (rules: readonly PackRule[]): number =>
  rules.filter((rule) => rule.mandatory && rule.basis_status === 'screening').length
