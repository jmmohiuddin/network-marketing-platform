import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { participantInScope } from './access.js'

const MANAGE = 'participant.manage'
/** D-V1A-10: at most four holders or signatories per account. */
const ACCOUNT_HOLDERS_MAX = 4
// D-V1A-06: the plan's "business" account is the stored type entity (as enrolment already takes it).
const REQUIRED_ROLE = { individual: null, joint: 'joint_holder', entity: 'authorised_signatory' } as const

const idParams = z.object({ id: z.uuid() })
const holder = z.strictObject({ name: z.string().trim().min(1).max(200), role: z.enum(['joint_holder', 'authorised_signatory']) })
const accountBody = z.strictObject({
  account_type: z.enum(['individual', 'joint', 'entity']),
  holders: z.array(holder).min(1).max(ACCOUNT_HOLDERS_MAX).optional(),
})
type AccountBody = z.infer<typeof accountBody>

const invalid = (field: string, message: string) => new ApiError(422, 'VALIDATION_FAILED', `${field} ${message}.`, { field })

/** AC-PAR4-1: individual has no holders; joint needs a joint holder, entity an authorised signatory. */
function holdersOf(body: AccountBody): AccountBody['holders'] | null {
  const role = REQUIRED_ROLE[body.account_type]
  if (role === null) {
    if (body.holders !== undefined) throw invalid('holders', 'are not recorded for an individual account')
    return null
  }
  if (body.holders === undefined || !body.holders.some((entry) => entry.role === role)) throw invalid('holders', `need at least one ${role}`)
  return body.holders
}

async function setAccount(tx: Tx, id: string, scope: readonly string[] | null, body: AccountBody) {
  const holders = holdersOf(body)
  const participant = await participantInScope(tx, id, scope, true)
  const { rows } = await tx.query<{ erased: boolean }>('SELECT pseudonymised_at IS NOT NULL AS erased FROM participant WHERE id = $1', [id])
  if (participant.status === 'merged') throw new ApiError(409, 'PARTICIPANT_MERGED', 'This participant was merged into another.')
  if (rows[0]!.erased) throw new ApiError(409, 'SUBJECT_ERASED', 'This person has been erased: their account details are gone.')
  await tx.query('UPDATE participant SET account_type = $2, account_holders = $3 WHERE id = $1', [id, body.account_type, holders === null ? null : JSON.stringify(holders)])
  const count = holders?.length ?? 0
  // Counts only: holder names are personal data (masked like the participant's name).
  await recordAudit(tx, { action: 'PARTICIPANT.ACCOUNT_CHANGED', objectType: 'participant', objectId: id, after: { account_type: body.account_type, holders_count: count } })
  return { account_type: body.account_type, account_holders_count: count }
}

/** FR-PAR-004 (D-V1A-06, SC-09): the account type and its holders; names are read only through the audited unmask. */
export function registerAccountRoutes(app: FastifyInstance): void {
  app.put('/v1/participants/:id/account', { preHandler: [requireRealm('tenant'), requirePermission(MANAGE)] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(accountBody, request.body)
    const scope = marketScope(currentAuth(request), MANAGE)
    return envelope(await inTenant(request, (tx) => setAccount(tx, id, scope, body)))
  })
}
