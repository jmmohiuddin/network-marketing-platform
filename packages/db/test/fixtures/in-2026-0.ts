// PLAN B-MKT D-BM-02 / section 1.1 / C-BM-4: the authored India pack IN-2026.0 rows (MONEY section 11). A TEST FIXTURE ONLY:
// no 07xx migration inserts them until the founder confirms C-9; then a later migration ships these rows unchanged.
// Every row is `screening` and `mandatory` from 2026-04-01. Items MONEY section 11 leaves To decide / To confirm (Form 26Q
// layout, delisted-register fields, plan-filing duty, GST, Hindi/regional languages, guardrails) have no row (C-12).

export const IN_PACK = 'IN-2026.0'
const COMMON = { market_pack: IN_PACK, mandatory: true, basis_status: 'screening', source_ref: 'PD-04 §2.2/§2.4', effective_from: '2026-04-01' }

/** Withholding on commission: 2 % above ₹20,000.00 (paise) per financial year, 20 % without a PAN. */
export const IN_TAX_RULES = [
  {
    ...COMMON, id: 'in-tds-commission@2026-04-01', title: 'Withholding on commission', kind: 'withholding', conditions: {},
    rate: '0.020000', threshold_minor: '2000000', threshold_basis: 'current_year_cumulative', missing_id_rate: '0.200000',
    // product default, s.288B rupee rounding to confirm
    rounding: 'half_up', basis: 's.393 Income-tax Act 2025',
  },
] as const

/** MONEY section 11 names no provision for these: basis is the item and its status, verbatim. */
export const IN_PACK_RULES = [
  {
    ...COMMON, id: 'in-tax-year@2026-04-01', kind: 'tax_year', title: 'Financial year', params: { start_month: 4, start_day: 1 },
    basis: 'Financial year April–March (Sourced)',
  },
  {
    ...COMMON, id: 'in-pan-format@2026-04-01', kind: 'tax_id_format', title: 'PAN format',
    params: { pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$', label: 'PAN' }, basis: 'Payee tax profile: PAN, PAN status (Product default)',
    examples: { valid: ['ABCDE1234F'], invalid: ['ABCDE1234', 'abcde1234f'] },
  },
  {
    ...COMMON, id: 'in-grievance@2026-04-01', kind: 'grievance_register', title: 'Grievance timers',
    params: { ack_hours: 48, resolution: { months: 1 } },
    basis: 'Grievance timers: ack 48 hours / resolution one month (Product default behaviour; values Sourced)',
  },
] as const
