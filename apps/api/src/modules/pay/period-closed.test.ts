import { randomUUID } from 'node:crypto'
import { withTenant } from '@nmp/db'
import { describe, expect, test } from 'vitest'
import { closePoolsAfterAll, ownerRows, resetApiDb } from '../../../test/helpers/index.js'
import { ApiError } from '../../lib/errors.js'
import { postInstruction } from './ledger.js'
import { participant, payWorld } from './test-support.js'

// D-B6-04 (PLAN B6 section 2.2): ledger_post refuses a closed period (23514 period_closed); PAY's instruction postings
// map it to 409 PERIOD_CLOSED.

closePoolsAfterAll()

describe('instruction postings into a closed period (D-B6-04)', () => {
  test('a settled event posting into a closed period is 409 PERIOD_CLOSED', async () => {
    await resetApiDb()
    const w = await payWorld()
    const payee = await participant(w.tenant.id, w.market)
    const [closed] = await ownerRows<{ id: string }>(
      `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state, closed_at, closed_by, close_note)
       SELECT tenant_id, calendar_id, ends_at, ends_at + interval '1 month', 'closed', now(), $2, 'Fixture' FROM period WHERE id = $1 RETURNING id`,
      [w.period, w.finance.id])

    const posting = withTenant({ tenantId: w.tenant.id, userId: w.finance.id }, (tx) =>
      postInstruction(tx, 'settled', { id: randomUUID(), marketId: w.market, periodId: closed!.id, payeeId: payee, amountMinor: '100' }, null))

    await expect(posting).rejects.toThrow(ApiError)
    await expect(posting).rejects.toMatchObject({ statusCode: 409, code: 'PERIOD_CLOSED' })
  })
})
