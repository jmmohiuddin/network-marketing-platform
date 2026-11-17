import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { assertStepUp, currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { envelope, parse } from '../../lib/http.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { participantInScope } from './access.js'
import { CONTACT_FIELDS, maskContact, type Contact } from './contact.js'
import { typeCode } from './schemas.js'

const READ = 'participant.read'
const UNMASK = 'participant.unmask'
const idParams = z.object({ id: z.uuid() })
const listQuery = z.strictObject({
  q: z.string().trim().min(1).max(200).optional(),
  market_id: z.uuid().optional(),
  type_code: typeCode.optional(),
  ...pageQuery,
})
const unmaskBody = z.strictObject({ fields: z.array(z.enum(CONTACT_FIELDS)).min(1).max(3).refine((f) => new Set(f).size === f.length, 'unique') })
const cursorSchema = z.tuple([z.iso.datetime({ offset: true }), z.uuid()])

interface ListRow {
  id: string
  created_at: Date
}

// q: an exact external reference or a name with trigram similarity >= 0.3 (pg_trgm %), PLAN B2 2.2.
async function listParticipants(tx: Tx, scope: readonly string[] | null, query: z.infer<typeof listQuery>) {
  const after = decodeCursor(query.cursor, cursorSchema)
  const { rows } = await tx.query<ListRow>(
    `SELECT p.id, p.external_ref, p.display_name, jsonb_build_object('id', m.id, 'code', m.code) AS market,
            CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('code', t.code, 'name', t.name) END AS current_type,
            p.status, p.enrolled_at,
            (SELECT jsonb_build_object('count', count(*)::int, 'active', (count(*) FILTER (WHERE o.status = 'active'))::int)
             FROM gen_positions_of(p.id, now()) o) AS positions,
            p.created_at
     FROM participant p
     JOIN market m ON m.id = p.market_id
     LEFT JOIN LATERAL par_type_at(p.id, now()) ct ON true
     LEFT JOIN participant_type t ON t.id = ct.type_id
     WHERE ($1::uuid[] IS NULL OR p.market_id = ANY ($1)) AND ($2::uuid IS NULL OR p.market_id = $2)
       AND ($3::text IS NULL OR t.code = $3)
       AND ($4::text IS NULL OR p.external_ref = $4 OR p.display_name % $4)
       AND ($5::timestamptz IS NULL OR (p.created_at, p.id) < ($5::timestamptz, $6::uuid))
     ORDER BY p.created_at DESC, p.id DESC LIMIT $7`,
    [scope, query.market_id ?? null, query.type_code ?? null, query.q ?? null, after?.[0] ?? null, after?.[1] ?? null, query.limit + 1],
  )
  const page = toPage(rows, query.limit, (row) => [row.created_at.toISOString(), row.id])
  return { ...page, data: page.data.map(({ created_at: _created, ...row }) => row) }
}

async function participantDetail(tx: Tx, id: string) {
  const { rows } = await tx.query<{ contact: Contact | null } & Record<string, unknown>>(
    `SELECT p.id, p.external_ref, p.account_type, jsonb_build_object('id', m.id, 'code', m.code) AS market, p.display_name,
            p.contact, p.status,
            CASE WHEN x.id IS NULL THEN NULL ELSE jsonb_build_object('id', x.id, 'external_ref', x.external_ref) END AS merged_into,
            p.enrolled_at,
            coalesce((SELECT jsonb_agg(jsonb_build_object('type', jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name),
                        'valid_from', a.valid_from, 'valid_to', a.valid_to) ORDER BY a.valid_from)
                      FROM participant_type_assignment a JOIN participant_type t ON t.id = a.type_id
                      WHERE a.participant_id = p.id), '[]') AS types,
            coalesce((SELECT jsonb_agg(jsonb_build_object('version', jsonb_build_object('id', v.id, 'label', v.label),
                        'accepted_at', c.accepted_at, 'evidence', c.evidence) ORDER BY c.accepted_at)
                      FROM agreement_acceptance c JOIN agreement_version v ON v.id = c.agreement_version_id
                      WHERE c.participant_id = p.id), '[]') AS agreements,
            coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.position_id, 'position_ref', o.position_ref, 'status', o.status,
                        'status_from', ps.status_from, 'market', jsonb_build_object('id', pm.id, 'code', pm.code),
                        'owned_from', o.owned_from, 'owned_to', o.owned_to) ORDER BY o.owned_from, o.position_id)
                      FROM gen_positions_of(p.id, NULL) o JOIN position ps ON ps.id = o.position_id
                      JOIN market pm ON pm.id = o.market_id), '[]') AS positions,
            EXISTS (SELECT 1 FROM case_file c WHERE c.type = 'duplicate' AND c.state IN ('open', 'submitted')
                      AND c.subject_type = 'participant' AND c.subject_id = p.id) AS duplicate_hold
     FROM participant p JOIN market m ON m.id = p.market_id LEFT JOIN participant x ON x.id = p.merged_into_id
     WHERE p.id = $1`,
    [id],
  )
  const { contact, ...row } = rows[0]!
  return { ...row, contact_masked: maskContact(contact) }
}

/** PLAN B2 2.2: participant list, record (contact masked) and the audited unmask. */
export function registerParticipantReadRoutes(app: FastifyInstance): void {
  const read = { preHandler: [requireRealm('tenant'), requirePermission(READ)] }
  app.get('/v1/participants', read, async (request) => {
    const query = parse(listQuery, request.query)
    const scope = marketScope(currentAuth(request), READ)
    return inTenant(request, (tx) => listParticipants(tx, scope, query))
  })

  app.get('/v1/participants/:id', read, async (request) => {
    const { id } = parse(idParams, request.params)
    const scope = marketScope(currentAuth(request), READ)
    return envelope(await inTenant(request, async (tx) => {
      await participantInScope(tx, id, scope)
      return participantDetail(tx, id)
    }))
  })

  app.post('/v1/participants/:id/unmask', { preHandler: [requireRealm('tenant'), requirePermission(UNMASK)] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const { fields } = parse(unmaskBody, request.body)
    const scope = marketScope(currentAuth(request), UNMASK)
    return envelope(await inTenant(request, async (tx) => {
      await participantInScope(tx, id, scope)
      assertStepUp(request)
      const { rows } = await tx.query<{ contact: Contact | null }>('SELECT contact FROM participant WHERE id = $1', [id])
      const contact = Object.fromEntries(fields.map((field) => [field, rows[0]!.contact?.[field] ?? null]))
      // Field names only: the values never reach the audit log.
      await recordAudit(tx, { action: 'PARTICIPANT.UNMASKED', objectType: 'participant', objectId: id, after: { participant_id: id, fields } })
      return { contact }
    }))
  })
}
