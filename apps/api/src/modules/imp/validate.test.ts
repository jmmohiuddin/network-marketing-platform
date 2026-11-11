import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { diskFileStore } from './file-store.js'
import { isForbiddenColumn } from './forbidden-columns.js'
import { impOptionsFromEnv } from './options.js'
import { LINES_HEADER, ORDERS_HEADER, syntheticFiles, tinyFiles, type CsvFiles } from './test-support.js'
import { validateImport } from './validate.js'
import { REQUIRED_COLUMNS, type ImportFile } from './vocabulary.js'

const YEAR_2025 = { from: '2025-01', to: '2025-12' }
const asBuffers = (files: CsvFiles) =>
  Object.fromEntries(Object.entries(files).map(([name, data]) => [name, Buffer.from(data)])) as Record<ImportFile, Buffer>
const validateTiny = (overrides: Partial<CsvFiles> = {}) => validateImport(asBuffers(tinyFiles(overrides)), YEAR_2025)
const codes = (result: ReturnType<typeof validateImport>) => result.findings.map((f) => [f.file, f.rowNo, f.column, f.code])

describe('validateImport on the synthetic export (MVP_A 3.3 golden control totals)', () => {
  test('is usable with the documented row counts, control totals and partner codes', () => {
    const result = validateImport(syntheticFiles(), YEAR_2025)

    expect(result.errorCount).toBe(0)
    expect(result.rowCounts).toEqual({ participants: 1466, orders: 4775, payout_lines: 7442 })
    expect(result.controlTotals).toEqual({
      order_amount_minor: '53195001', order_volume_minor: '53195001', order_refunded_minor: '2600070', payout_amount_minor: '9225679',
    })
    expect(result.sourceValues).toEqual({
      participant_types: { customer: 667, distributor: 449, preferred_customer: 350 },
      purposes: { customer: 2439, enrolment: 429, personal: 1365, resale: 365, unknown: 177 },
      source_kinds: { clawback: 321, downline_volume: 4159, enrolment_order: 429, pool: 94, retail_sale: 2439 },
      starter_kits: { 0: 4346, 1: 429 },
    })
    expect(result.rows?.payoutLines.filter((line) => line.sourceOrderRef === null)).toHaveLength(94)
    expect(result.warnings.map((w) => w.code)).toEqual(['PARTICIPANT_TYPES'])
  })

  test('months outside the declared period are refused', () => {
    const result = validateImport(syntheticFiles(), { from: '2025-01', to: '2025-06' })

    // Orders and payout lines of 2025-07..12 (MVP_A data: 1,417 orders and 2,085 lines fall in 2025-01..06).
    expect(result.errorCount).toBe((4775 - 1417) + (7442 - 2085))
    expect(new Set(result.findings.map((f) => f.code))).toEqual(new Set(['OUT_OF_RANGE']))
  })
})

describe('file-level checks stop before the rows', () => {
  test('TS-32: forbidden columns are named and nothing else is checked', () => {
    const result = validateTiny({
      participants: 'participant_id,type,enrolled_month,sponsor_id,email,phone,bank_account,national_id,Home Address\nD1,dist,2025-01,,a,b,c,d,e\n',
    })

    expect(codes(result)).toEqual(['email', 'phone', 'bank_account', 'national_id', 'Home Address'].map((column) =>
      ['participants', 1, column, 'FORBIDDEN_COLUMN']))
    expect(result.rowCounts).toBeNull()
    expect(result.rows).toBeNull()
  })

  test('forbidden columns are caught in camelCase, joined and spelled-out forms; the published columns are not', () => {
    const spellings = [
      'bankAccount', 'emailAddress', 'phoneNumber', 'homeAddress', 'EmailAddress', 'PhoneNumber', 'tax_id', 'surname', 'e_mail',
      'E-Mail', 'telephone', 'tel', 'postal_code', 'city', 'contact', 'e_mail_addr', 'IBANNumber', 'iban',
    ]
    const extra = ['bankAccount', 'emailAddress', 'tax_id', 'surname']
    const header = ['participant_id', 'type', 'enrolled_month', 'sponsor_id', ...extra].join(',')
    const result = validateTiny({ participants: `${header}\nD1,dist,2025-01,${',x'.repeat(extra.length)}\n` })

    expect(spellings.filter((column) => !isForbiddenColumn(column))).toEqual([])
    expect(codes(result)).toEqual(extra.map((column) => ['participants', 1, column, 'FORBIDDEN_COLUMN']))
    expect(Object.values(REQUIRED_COLUMNS).flat().filter(isForbiddenColumn)).toEqual([])
  })

  test('a column outside the format holding email addresses is forbidden; other extra columns are never stored', () => {
    const sampled = validateTiny({ participants: 'participant_id,type,enrolled_month,sponsor_id,ref2\nD1,dist,2025-01,,d1@example.com\nC1,cust,2025-01,D1,\n' })
    const extra = validateTiny({ participants: 'participant_id,Type,enrolled_month,sponsor_id,note\nD1,dist,2025-01,,north\nC1,cust,2025-01,D1,"a, ""b"""\n' })

    expect(codes(sampled)).toEqual([['participants', 1, 'ref2', 'FORBIDDEN_COLUMN']])
    expect(extra.errorCount).toBe(0)
    expect(extra.storedFiles?.participants.toString()).toBe(
      '"participant_id","type","enrolled_month","sponsor_id"\n"D1","dist","2025-01",""\n"C1","cust","2025-01","D1"\n',
    )
    expect(validateImport(extra.storedFiles!, YEAR_2025).rows).toEqual(extra.rows)
  })

  test('missing and repeated columns are schema mismatches', () => {
    const result = validateTiny({ orders: 'order_id,month,day,buyer_id,amount_cents,volume_cents,purpose,purpose\n' })

    expect(codes(result)).toEqual([
      ['orders', 1, 'purpose', 'SCHEMA_MISMATCH'],
      ['orders', 1, 'is_starter_kit', 'SCHEMA_MISMATCH'],
      ['orders', 1, 'refunded_cents', 'SCHEMA_MISMATCH'],
      ['orders', 1, 'refund_month', 'SCHEMA_MISMATCH'],
    ])
  })

  test('non-UTF-8, empty and ragged files are schema mismatches; a BOM is tolerated', () => {
    const latin1 = Buffer.from([0x70, 0xe9, 0x0a])
    const result = validateImport({ ...asBuffers(tinyFiles()), participants: latin1, orders: Buffer.alloc(0) }, YEAR_2025)
    const ragged = validateTiny({ payout_lines: 'line_id,month\nL1,2025-01,extra\n' })
    const withBom = validateImport({ ...asBuffers(tinyFiles()), participants: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(tinyFiles().participants)]) }, YEAR_2025)

    expect(codes(result)).toEqual([['participants', null, null, 'SCHEMA_MISMATCH'], ['orders', null, null, 'SCHEMA_MISMATCH']])
    expect(codes(ragged)).toEqual([['payout_lines', 2, null, 'SCHEMA_MISMATCH']])
    expect(withBom.errorCount).toBe(0)
  })
})

describe('row checks', () => {
  test('the tiny export is valid and keeps amounts as bigint', () => {
    const result = validateTiny()

    expect(result.errorCount).toBe(0)
    expect(result.controlTotals).toEqual({ order_amount_minor: '14000', order_volume_minor: '13000', order_refunded_minor: '4000', payout_amount_minor: '3200' })
    expect(result.rows?.orders[0]).toMatchObject({ orderDate: '2025-01-05', amount: 10000n, starterKitCode: '0', refundMonth: null })
    expect(result.sourceValues?.starter_kits).toEqual({ 0: 1, 1: 1 })
  })

  test('duplicates, orphans, bad values and refunds above the amount are each reported on their line', () => {
    const result = validateTiny({
      participants: 'participant_id,type,enrolled_month,sponsor_id\nD1,dist,2025-01,\nD1,dist,2025-13,X9\nme@example.com,dist,2025-01,\n',
      orders: 'order_id,month,day,buyer_id,amount_cents,volume_cents,purpose,is_starter_kit,refunded_cents,refund_month\n'
        + 'O1,2025-02,30,C9,10.5,100,,2,200,2025-1\nO1,2025-01,31,D1,100,100,own,0,101,\n',
      payout_lines: 'line_id,month,payee_id,bonus_type,source_kind,source_order_id,amount_cents\n'
        + 'L1,2025-01,D1,retail,retail_sale,,-5\nL1,2025-01,P7,pool,pool,O9,x\n',
    })

    expect(codes(result)).toEqual([
      ['participants', 3, 'participant_id', 'DUPLICATE_KEY'],
      ['participants', 3, 'enrolled_month', 'INVALID_VALUE'],
      ['participants', 4, 'participant_id', 'NOT_PSEUDONYMOUS'],
      ['orders', 2, 'day', 'INVALID_VALUE'],
      ['orders', 2, 'buyer_id', 'ORPHAN_REFERENCE'],
      ['orders', 2, 'amount_cents', 'INVALID_VALUE'],
      ['orders', 2, 'purpose', 'INVALID_VALUE'],
      ['orders', 2, 'refund_month', 'INVALID_VALUE'],
      ['orders', 3, 'order_id', 'DUPLICATE_KEY'],
      ['orders', 3, 'refunded_cents', 'REFUND_EXCEEDS_AMOUNT'],
      ['payout_lines', 2, 'source_order_id', 'ORPHAN_REFERENCE'],
      ['payout_lines', 3, 'line_id', 'DUPLICATE_KEY'],
      ['payout_lines', 3, 'payee_id', 'ORPHAN_REFERENCE'],
      ['payout_lines', 3, 'source_order_id', 'ORPHAN_REFERENCE'],
      ['payout_lines', 3, 'amount_cents', 'INVALID_VALUE'],
    ])
    expect(result.findings.some((f) => f.detail.includes('me@example.com'))).toBe(false)
    expect(result.controlTotals).toBeNull()
  })

  test('every id copied into the facts must be pseudonymous; an email-like value is never echoed (BR-IMP-02)', () => {
    const result = validateTiny({
      participants: 'participant_id,type,enrolled_month,sponsor_id\nD1,dist,2025-01,jane.doe@example.com\nme@example.com,,2025-13,\nC1,cust,2025-01,D1\n',
      orders: `${ORDERS_HEADER}\nO1,2025-01,5,buyer@example.com,100,100,c,0,0,\n`,
    })

    expect(codes(result)).toEqual([
      ['participants', 2, 'sponsor_id', 'NOT_PSEUDONYMOUS'],
      ['participants', 3, 'participant_id', 'NOT_PSEUDONYMOUS'],
      ['participants', 3, 'type', 'INVALID_VALUE'],
      ['participants', 3, 'enrolled_month', 'INVALID_VALUE'],
      ['orders', 2, 'buyer_id', 'NOT_PSEUDONYMOUS'],
    ])
    expect(result.findings.filter((finding) => finding.detail.includes('@'))).toEqual([])
  })

  test('ids, codes and the number of distinct codes stay within what the facts and a mapping can hold', () => {
    const header = 'participant_id,type,enrolled_month,sponsor_id'
    const manyTypes = Array.from({ length: 1001 }, (_, index) => `P${index},t${index},2025-01,`).join('\n')
    const tooLong = validateTiny({ participants: `${header}\n${'P'.repeat(4000)},dist,2025-01,\nD1,${'t'.repeat(101)},2025-01,\nC1,cust,2025-01,D1\n` })
    const tooMany = validateTiny({ participants: `${header}\nD1,dist,2025-01,\nC1,cust,2025-01,D1\n${manyTypes}\n` })

    expect(codes(tooLong)).toEqual([['participants', 2, 'participant_id', 'INVALID_VALUE'], ['participants', 3, 'type', 'INVALID_VALUE']])
    expect(codes(tooMany)).toEqual([['participants', null, 'type', 'INVALID_VALUE']])
  })

  test('order amounts cannot be negative; payout line amounts can (clawbacks)', () => {
    const result = validateTiny({
      orders: `${ORDERS_HEADER}\nO1,2025-01,5,C1,10000,9000,cust_order,0,-5000,\nO2,2025-01,6,D1,-300,0,own,0,0,\n`,
      payout_lines: `${LINES_HEADER}\nL1,2025-01,D1,claw,clawback,O1,-2500\n`,
    })

    expect(codes(result)).toEqual([['orders', 2, 'refunded_cents', 'INVALID_VALUE'], ['orders', 3, 'amount_cents', 'INVALID_VALUE']])
  })

  test('warnings name sponsors outside the file and refunds without a refund month', () => {
    const result = validateTiny({
      participants: 'participant_id,type,enrolled_month,sponsor_id\nD1,dist,2025-01,UP1\nC1,cust,2025-01,D1\n',
      orders: 'order_id,month,day,buyer_id,amount_cents,volume_cents,purpose,is_starter_kit,refunded_cents,refund_month\nO1,2025-01,5,C1,100,100,c,0,100,\n',
      payout_lines: 'line_id,month,payee_id,bonus_type,source_kind,source_order_id,amount_cents\n',
    })

    expect(result.errorCount).toBe(0)
    expect(result.warnings.map((w) => [w.code, w.count])).toEqual([['PARTICIPANT_TYPES', 2], ['SPONSOR_NOT_IN_FILE', 1], ['REFUND_WITHOUT_MONTH', 1]])
  })
})

describe('impOptionsFromEnv', () => {
  test('a relative UPLOAD_DIR resolves against apps/api, not the working directory; the default file limit is 10 MiB', () => {
    const relative = impOptionsFromEnv({ UPLOAD_DIR: 'var/imp-test' })
    const absolute = impOptionsFromEnv({ UPLOAD_DIR: '/srv/nmp/uploads' })

    expect(relative.uploadDir).toBe(join(dirname(fileURLToPath(import.meta.url)), '../../../var/imp-test'))
    expect(absolute.uploadDir).toBe('/srv/nmp/uploads')
    expect(relative.maxFileBytes).toBe(10 * 1024 * 1024)
  })
})

describe('diskFileStore', () => {
  test('stores per tenant and batch, never overwrites, and refuses keys that are not UUIDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nmp-imp-store-'))
    const store = diskFileStore(root)
    const tenant = '0b6f1c1e-6c55-4c1a-9d5e-1f2a3b4c5d6e'
    const batch = '7d4c2b1a-1111-4222-8333-944455566677'

    await store.put(tenant, batch, 'orders', Buffer.from('a,b\n'))

    expect((await store.get(tenant, batch, 'orders')).toString()).toBe('a,b\n')
    await expect(store.put(tenant, batch, 'orders', Buffer.from('x'))).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(store.put('../etc', batch, 'orders', Buffer.from('x'))).rejects.toThrow(/UUID/)
    await expect(store.get(tenant, batch, '../../x' as ImportFile)).rejects.toThrow(/unknown import file/)
    await store.removeBatch(tenant, batch)
    expect(await readdir(join(root, tenant))).toEqual([])
  })
})
