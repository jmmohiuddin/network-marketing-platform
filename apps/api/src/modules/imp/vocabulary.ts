/** The three overlay export files (MVP_A_SPEC 3), in the order they are checked. */
export const IMPORT_FILES = ['participants', 'orders', 'payout_lines'] as const
export type ImportFile = (typeof IMPORT_FILES)[number]

export const REQUIRED_COLUMNS: Readonly<Record<ImportFile, readonly string[]>> = {
  participants: ['participant_id', 'type', 'enrolled_month', 'sponsor_id'],
  orders: ['order_id', 'month', 'day', 'buyer_id', 'amount_cents', 'volume_cents', 'purpose', 'is_starter_kit',
    'refunded_cents', 'refund_month'],
  payout_lines: ['line_id', 'month', 'payee_id', 'bonus_type', 'source_kind', 'source_order_id', 'amount_cents'],
}

/** Longest id or reference accepted (the fact tables index them; btree entries are capped at 2704 bytes). */
export const MAX_ID_LENGTH = 200
/** Longest partner code, and most distinct codes per vocabulary, that a mapping can name (FR-IMP-002). */
export const MAX_CODE_LENGTH = 100
export const MAX_CODES = 1000

/** Platform vocabularies partner codes are mapped to (FR-IMP-002, cpl_fact_* CHECKs). */
export const PURPOSES = ['customer', 'personal', 'resale', 'enrolment', 'unknown'] as const
export type Purpose = (typeof PURPOSES)[number]

export const SOURCE_KINDS = [
  'retail_sale', 'downline_volume', 'enrolment_order', 'pool', 'match', 'clawback', 'other', 'unknown',
] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** Payout lines of these kinds come from one order and must name it (prototype V14). */
export const ORDER_LEVEL_SOURCE_KINDS: ReadonlySet<string> = new Set([
  'retail_sale', 'downline_volume', 'enrolment_order', 'clawback',
])

/** import_row_error.code values (API.md 2.3 plus the type and range codes the validator needs). */
export type RowErrorCode =
  | 'FORBIDDEN_COLUMN' | 'SCHEMA_MISMATCH' | 'DUPLICATE_KEY' | 'ORPHAN_REFERENCE' | 'INVALID_VALUE'
  | 'OUT_OF_RANGE' | 'REFUND_EXCEEDS_AMOUNT' | 'NOT_PSEUDONYMOUS'
