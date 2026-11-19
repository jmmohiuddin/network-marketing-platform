import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { BankDetails, bankVersionContext, compact } from '../../lib/bank-crypto.js'
import { toCsv } from '../../lib/csv.js'
import { ApiError } from '../../lib/errors.js'
import { open } from '../../lib/secret-box.js'
import { findBatch, type Scope } from './batches.js'
import { auditState, factsOf, failIfSuperseded, INSTRUCTION_SELECT, type InstructionRow } from './instructions.js'
import { formatMinor } from './money.js'
import { signatureValid } from './signing.js'

const HEADER = ['end_to_end_id', 'payee_ref', 'account_holder', 'scheme', 'iban', 'bic', 'account_number', 'bank_code', 'amount', 'currency']

interface FileRow extends InstructionRow {
  readonly details_sealed: string
  readonly payee_ref: string
  readonly digits: number
}

/**
 * D-B4-14 bank-file adapter: one CSV row per signed instruction still to be paid, decrypted from the pinned bank-detail
 * version. The first generation moves pending -> instructed (provider_ref = the instruction id, the file's
 * end_to_end_id); later generations return the same rows. A pending row whose account was superseded fails instead.
 * Nothing is stored.
 */
export async function generateBankFile(tx: Tx, secretKey: Buffer, batchId: string, scope: Scope): Promise<string> {
  const batch = await findBatch(tx, batchId, scope, true)
  const { rows: providers } = await tx.query<{ adapter: string | null }>('SELECT adapter FROM provider_config WHERE id = $1', [batch.provider_config_id])
  if (providers[0]?.adapter !== 'bank_file_csv') throw new ApiError(422, 'ADAPTER_MISMATCH', 'This batch pays through a provider without the bank-file adapter.')
  if (!['instructing', 'partially_settled'].includes(batch.state)) {
    throw new ApiError(409, 'BATCH_STATE', `The batch is ${batch.state}: a bank file exists once it is approved.`, { state: batch.state })
  }
  const { rows } = await tx.query<FileRow>(
    `${INSTRUCTION_SELECT.replace('FROM payout_instruction i', ', v.details_sealed, x.external_ref AS payee_ref, m.minor_unit AS digits FROM payout_instruction i')}
     JOIN bank_detail_version v ON v.id = i.bank_detail_version_id JOIN participant x ON x.id = i.payee_participant_id
     JOIN market m ON m.id = b.market_id
     WHERE i.batch_id = $1 AND i.state IN ('pending', 'instructed') AND i.last_error IS DISTINCT FROM 'SIGNATURE_INVALID'
     ORDER BY i.id FOR UPDATE OF i`,
    [batchId],
  )
  const lines: string[][] = []
  for (const row of rows) {
    if (!signatureValid(secretKey, factsOf(row), row.signature)) {
      await tx.query(`UPDATE payout_instruction SET last_error = 'SIGNATURE_INVALID', next_attempt_at = NULL WHERE id = $1`, [row.id])
      await recordAudit(tx, { action: 'PAYOUT.SIGNATURE_INVALID', objectType: 'payout_instruction', objectId: row.id, after: { batch_id: batchId } })
      continue
    }
    // An instructed row is already in a file the bank holds: it stays in every regeneration (the result file settles it).
    if (row.state === 'pending' && await failIfSuperseded(tx, row)) continue
    if (row.state === 'pending') {
      await tx.query(
        `UPDATE payout_instruction SET state = 'instructed', provider_ref = id::text, instructed_at = now(), next_attempt_at = NULL WHERE id = $1`, [row.id])
      await auditState(tx, row.id, 'pending', 'instructed')
    }
    const details = BankDetails.parse(JSON.parse(open(secretKey, row.details_sealed, bankVersionContext(row.bank_detail_version_id))))
    // The electronic form banks expect (upper case, no spaces or separators), whatever staff typed.
    const account = details.scheme === 'iban'
      ? { iban: compact(details.iban), bic: compact(details.bic ?? ''), account_number: '', bank_code: '' }
      : { iban: '', bic: '', account_number: compact(details.account_number), bank_code: compact(details.bank_code) }
    lines.push([row.id, row.payee_ref, details.account_holder, details.scheme, account.iban, account.bic, account.account_number, account.bank_code,
      formatMinor(row.amount_minor, row.digits), row.currency])
  }
  await recordAudit(tx, { action: 'PAYOUT.BANK_FILE_GENERATED', objectType: 'payout_batch', objectId: batchId, after: { batch_id: batchId, rows: lines.length } })
  return toCsv(HEADER, lines)
}
