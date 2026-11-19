import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, requirePortal } from '../../lib/auth.js'
import { inPortal } from '../../lib/db.js'
import { ApiError, notFound, validationFailed } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'

// API-28 inbox and email preferences (PLAN B5 2.5, D-B5-14). The participant comes from the portal session only; the
// RESTRICTIVE self policies hide every other participant's rows besides the explicit filter.

const PAGE_MAX = 50
const OPTIONAL_TOPICS = ['statement', 'payout', 'dispute'] as const
const MANDATORY_TOPICS = ['security', 'privacy', 'plan_change'] as const

const idParams = z.object({ id: z.uuid() })
const listQuery = z.strictObject({
  unread: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  cursor: pageQuery.cursor,
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_MAX),
})
const preferenceBody = z.strictObject({ topic: z.enum(OPTIONAL_TOPICS), email: z.boolean() })

const VIEW = 'id, template, topic, mandatory, params, created_at, read_at'

const self = (request: FastifyRequest): string => currentAuth(request).participantId!

async function preferences(tx: Tx, participantId: string) {
  const { rows } = await tx.query<{ topic: string; email: boolean }>(
    'SELECT topic, email FROM notification_preference WHERE participant_id = $1', [participantId])
  const stored = new Map(rows.map((row) => [row.topic, row.email]))
  return [
    ...OPTIONAL_TOPICS.map((topic) => ({ topic, email: stored.get(topic) ?? true, mandatory: false })),
    ...MANDATORY_TOPICS.map((topic) => ({ topic, mandatory: true })),
  ]
}

function registerInbox(app: FastifyInstance): void {
  const portal = { preHandler: [requirePortal()] }

  app.get('/v1/me/notifications', portal, async (request) => {
    const query = parse(listQuery, request.query)
    const after = decodeCursor(query.cursor, z.uuid())
    const participantId = self(request)
    return inPortal(request, async (tx) => {
      // The cursor is the last row's id: its (created_at, id) is read back exactly (microseconds included).
      const { rows } = await tx.query<{ id: string }>(
        `SELECT ${VIEW} FROM notification
         WHERE recipient_participant_id = $1 AND channel = 'in_app' AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
           AND ($3::uuid IS NULL OR (created_at, id) < (SELECT c.created_at, c.id FROM notification c WHERE c.id = $3))
         ORDER BY created_at DESC, id DESC LIMIT $4`,
        [participantId, query.unread ?? null, after ?? null, query.limit + 1],
      )
      const { rows: unread } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification WHERE recipient_participant_id = $1 AND channel = 'in_app' AND read_at IS NULL`,
        [participantId],
      )
      const page = toPage(rows, query.limit, (row) => row.id)
      return envelope(page.data, { ...page.meta, unread_count: unread[0]!.n })
    })
  })

  app.post('/v1/me/notifications/:id/read', portal, async (request) => {
    const { id } = parse(idParams, request.params)
    const participantId = self(request)
    return envelope(await inPortal(request, async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE notification SET read_at = now()
         WHERE id = $1 AND recipient_participant_id = $2 AND channel = 'in_app' AND read_at IS NULL`,
        [id, participantId],
      )
      if (rowCount === 1) await recordAudit(tx, { action: 'NOTIFICATION.READ', objectType: 'notification', objectId: id })
      const { rows } = await tx.query(
        `SELECT ${VIEW} FROM notification WHERE id = $1 AND recipient_participant_id = $2 AND channel = 'in_app'`, [id, participantId])
      if (rows[0] === undefined) throw notFound()
      return rows[0]
    }))
  })

  app.post('/v1/me/notifications/read-all', portal, async (request) => {
    const participantId = self(request)
    const updated = await inPortal(request, async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE notification SET read_at = now() WHERE recipient_participant_id = $1 AND channel = 'in_app' AND read_at IS NULL`,
        [participantId],
      )
      const count = rowCount ?? 0
      if (count > 0) await recordAudit(tx, { action: 'NOTIFICATION.READ_ALL', objectType: 'participant', objectId: participantId, after: { updated: count } })
      return count
    })
    return envelope({ updated })
  })
}

function registerPreferences(app: FastifyInstance): void {
  const portal = { preHandler: [requirePortal()] }

  app.get('/v1/me/notification-preferences', portal, async (request) => {
    const participantId = self(request)
    return envelope(await inPortal(request, (tx) => preferences(tx, participantId)))
  })

  // Only the email of statement, payout and dispute notices can be switched off (AC-DIST8-2); in-app never.
  app.put('/v1/me/notification-preferences', portal, async (request) => {
    const result = preferenceBody.safeParse(request.body)
    if (!result.success) {
      const { code, message, details } = validationFailed(result.error)
      throw new ApiError(422, code, message, details)
    }
    const { topic, email } = result.data
    const participantId = self(request)
    return envelope(await inPortal(request, async (tx) => {
      const { rows } = await tx.query<{ email: boolean }>(
        'SELECT email FROM notification_preference WHERE participant_id = $1 AND topic = $2 FOR UPDATE', [participantId, topic])
      await tx.query(
        `INSERT INTO notification_preference (tenant_id, participant_id, topic, email) VALUES (app_tenant_id(), $1, $2, $3)
         ON CONFLICT (tenant_id, participant_id, topic) DO UPDATE SET email = EXCLUDED.email, updated_at = now(), updated_by = app_user_id()`,
        [participantId, topic, email],
      )
      await recordAudit(tx, {
        action: 'NOTIFICATION_PREFERENCE.CHANGED', objectType: 'notification_preference', objectId: participantId,
        before: { topic, email: rows[0]?.email ?? true }, after: { topic, email },
      })
      return preferences(tx, participantId)
    }))
  })
}

export function registerNotificationRoutes(app: FastifyInstance): void {
  registerInbox(app)
  registerPreferences(app)
}
