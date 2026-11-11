import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { assertStepUp, currentAuth, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound, permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { getEffectiveSettings, getLatestVersion, isSettingKey, SETTINGS, type SettingKey } from './settings.js'
import { putSetting } from './settings-write.js'

const keyParams = z.object({ key: z.string().max(100) })
const putBody = z.strictObject({
  value: z.unknown(),
  reason: z.string().trim().min(1).max(500),
  effective_from: z.iso.datetime({ offset: true }).optional(),
})
const IF_MATCH = /^(?:W\/)?"?(\d{1,9})"?$/

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

/** API-39 for release A keys: read the value in force, write a new version (settings.manage). */
export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/v1/settings/:key', { preHandler: [requireRealm('tenant')] }, async (request, reply) => {
    const key = settingKey(request)
    const auth = currentAuth(request)
    if (!SETTINGS[key].readPermissions.some((permission) => auth.permissions.has(permission))) throw permissionDenied()
    const { effective, latest } = await inTenant(request, async (tx) => ({
      effective: await getEffectiveSettings(tx),
      latest: await getLatestVersion(tx),
    }))
    const latestVersion = latest?.version ?? 0
    reply.header('etag', `"${latestVersion}"`)
    return envelope(
      {
        key,
        value: effective?.values[key] ?? null,
        version: effective?.version ?? null,
        effective_from: effective?.effectiveFrom ?? null,
      },
      { latest_version: latestVersion },
    )
  })

  app.put(
    '/v1/settings/:key',
    { preHandler: [requireRealm('tenant'), requirePermission('settings.manage')] },
    async (request, reply) => {
      const key = settingKey(request)
      if (SETTINGS[key].stepUp) assertStepUp(request)
      const version = expectedVersion(request)
      const body = parse(putBody, request.body)
      const value: unknown = parse(z.object({ value: SETTINGS[key].schema }), { value: body.value }).value
      const write = { key, value, reason: body.reason, effectiveFrom: body.effective_from === undefined ? null : new Date(body.effective_from), expectedVersion: version }
      const saved = await inTenant(request, (tx) => putSetting(tx, write))
      reply.header('etag', `"${saved.version}"`)
      return envelope(saved)
    },
  )
}
