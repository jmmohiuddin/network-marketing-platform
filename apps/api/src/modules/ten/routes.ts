import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { assertStepUp, currentAuth, requireAllMarkets, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound, permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { sendIdempotent } from '../../lib/idempotency.js'
import { pageQuery } from '../../lib/pagination.js'
import { changeRequestView, decideChangeRequest, listChangeRequests, withdrawChangeRequest } from './change-requests.js'
import { requireAnyPermission } from './scope.js'
import { canReadSetting, getEffectiveSettings, isSettingKey, SETTINGS, type SettingKey } from './settings.js'
import { createChangeRequest, putSetting } from './settings-write.js'
import { valueSince } from './timeline.js'
import { decideWithSod } from './sod.js'
import { listVersions, versionDetail } from './version-history.js'
import { latestVersionNumber, loadChain } from './versions.js'

const keyParams = z.object({ key: z.string().max(100) })
const versionParams = z.object({ version: z.coerce.number().int().positive().max(2_147_483_647) })
const idParams = z.object({ id: z.uuid() })
const reasonField = z.string().trim().min(1).max(500)
const putBody = z.strictObject({
  value: z.unknown(),
  reason: reasonField,
  effective_from: z.iso.datetime({ offset: true }).optional(),
})
const decisionBody = z.strictObject({ decision: z.enum(['approve', 'reject']), reason: reasonField })
const withdrawBody = z.strictObject({ reason: reasonField })
const changeRequestQuery = z.strictObject({ state: z.enum(['pending', 'all']).default('pending'), ...pageQuery })
const versionsQuery = z.strictObject(pageQuery)
const IF_MATCH = /^(?:W\/)?"?(\d{1,9})"?$/
const SETTINGS_READERS = ['settings.manage', 'settings.approve'] as const

function settingKey(request: FastifyRequest): SettingKey {
  const { key } = parse(keyParams, request.params)
  if (!isSettingKey(key)) throw notFound()
  return key
}

function expectedVersion(request: FastifyRequest): number {
  const header = request.headers['if-match']
  if (header === undefined) {
    throw new ApiError(428, 'PRECONDITION_REQUIRED', 'Send If-Match with the version you are changing ("0" for none).')
  }
  const match = IF_MATCH.exec(header)
  if (match === null) throw new ApiError(400, 'VALIDATION_FAILED', 'If-Match must be a version number.')
  return Number(match[1])
}

/** Values in force now with value_since (BUG-025), for the keys given. */
async function currentValues(request: FastifyRequest, keys: readonly SettingKey[]) {
  return inTenant(request, async (tx) => {
    const effective = await getEffectiveSettings(tx)
    const chain = await loadChain(tx)
    const now = new Date()
    const values = Object.fromEntries(keys.map((key) => [key, { value: effective?.values[key] ?? null, value_since: valueSince(chain, key, now) }]))
    return { effective, values, latest: await latestVersionNumber(tx) }
  })
}

/** API-39: read the values in force and their history; write a new version or, for money keys, a change request. */
export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/v1/settings', { preHandler: [requireRealm('tenant'), requireAnyPermission(...SETTINGS_READERS)] }, async (request, reply) => {
    const auth = currentAuth(request)
    const keys = (Object.keys(SETTINGS) as SettingKey[]).filter((key) => canReadSetting(auth.permissions, key))
    const { effective, values, latest } = await currentValues(request, keys)
    reply.header('etag', `"${latest}"`)
    return envelope({ version: effective?.version ?? null, effective_from: effective?.effectiveFrom ?? null, values }, { latest_version: latest })
  })

  app.get('/v1/settings/versions', { preHandler: [requireRealm('tenant'), requireAnyPermission(...SETTINGS_READERS)] }, async (request) => {
    const query = parse(versionsQuery, request.query)
    return inTenant(request, (tx) => listVersions(tx, query))
  })

  app.get('/v1/settings/versions/:version', { preHandler: [requireRealm('tenant'), requireAnyPermission(...SETTINGS_READERS)] }, async (request) => {
    const { version } = parse(versionParams, request.params)
    const auth = currentAuth(request)
    const detail = await inTenant(request, (tx) => versionDetail(tx, version, (key) => canReadSetting(auth.permissions, key)))
    if (detail === null) throw notFound()
    return envelope(detail)
  })

  app.get('/v1/settings/:key', { preHandler: [requireRealm('tenant')] }, async (request, reply) => {
    const key = settingKey(request)
    if (!canReadSetting(currentAuth(request).permissions, key)) throw permissionDenied()
    const { effective, values, latest } = await currentValues(request, [key])
    reply.header('etag', `"${latest}"`)
    return envelope(
      { key, value: values[key]!.value, version: effective?.version ?? null, effective_from: effective?.effectiveFrom ?? null, value_since: values[key]!.value_since },
      { latest_version: latest },
    )
  })

  // Settings are tenant-wide: every market's engine reads them, so writing and approving need all-markets scope.
  const manageAll = [requireRealm('tenant'), requirePermission('settings.manage'), requireAllMarkets('settings.manage')]
  app.put('/v1/settings/:key', { preHandler: manageAll }, async (request, reply) => {
    const key = settingKey(request)
    const definition = SETTINGS[key]
    if (definition.stepUp) assertStepUp(request)
    const version = expectedVersion(request)
    const body = parse(putBody, request.body)
    const value: unknown = parse(z.object({ value: definition.schema }), { value: body.value }).value
    const effectiveFrom = body.effective_from === undefined ? null : new Date(body.effective_from)
    const write = { key, value, reason: body.reason, effectiveFrom, expectedVersion: version }
    if (definition.moneyAffecting) {
      if (effectiveFrom === null) {
        throw new ApiError(400, 'VALIDATION_FAILED', 'A money-affecting setting needs an effective date.', {
          issues: [{ path: 'effective_from', message: 'required for money-affecting settings' }],
        })
      }
      const changeRequest = await inTenant(request, async (tx) => {
        const created = await createChangeRequest(tx, { ...write, effectiveFrom })
        return changeRequestView(tx, created.id)
      })
      reply.header('etag', `"${version}"`)
      return reply.code(202).send(envelope({ change_request: changeRequest }, { latest_version: version }))
    }
    const saved = await inTenant(request, (tx) => putSetting(tx, write))
    reply.header('etag', `"${saved.latestVersion}"`)
    return envelope(saved.view, { latest_version: saved.latestVersion })
  })

  app.get('/v1/setting-change-requests', { preHandler: [requireRealm('tenant'), requireAnyPermission(...SETTINGS_READERS)] }, async (request) => {
    const query = parse(changeRequestQuery, request.query)
    return inTenant(request, (tx) => listChangeRequests(tx, query))
  })

  app.post(
    '/v1/setting-change-requests/:id/decision',
    { preHandler: [requireRealm('tenant'), requirePermission('settings.approve'), requireAllMarkets('settings.approve')] },
    async (request, reply) => {
      assertStepUp(request)
      const { id } = parse(idParams, request.params)
      const body = parse(decisionBody, request.body)
      const factorVerifiedAt = currentAuth(request).stepUpAt
      const result = await decideWithSod(request, async (tx) => ({
        statusCode: 200, body: envelope(await decideChangeRequest(tx, id, { ...body, factorVerifiedAt })),
      }))
      return sendIdempotent(reply, result)
    },
  )

  app.post(
    '/v1/setting-change-requests/:id/withdraw',
    { preHandler: [requireRealm('tenant'), requirePermission('settings.manage')] },
    async (request) => {
      const { id } = parse(idParams, request.params)
      const { reason } = parse(withdrawBody, request.body)
      return envelope(await inTenant(request, (tx) => withdrawChangeRequest(tx, id, reason)))
    },
  )
}
