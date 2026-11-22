import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { inTenant } from './db.js'
import { ApiError } from './errors.js'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Writes a read-only tenant (D-V1A-07: offboarding confirmed, or archived) may still make, as `METHOD /route`: auth,
 * the final full export, cancelling the offboarding, and the data-subject routes the tenant must still answer as
 * controller (C-V1A-18).
 */
export const READ_ONLY_ALLOWLIST: readonly RegExp[] = [
  /^(POST|PUT|PATCH|DELETE) \/v1\/auth\//,
  /^POST \/v1\/exports$/,
  /^POST \/v1\/offboarding\/cancel$/,
  /^POST \/v1\/public\/privacy-requests$/,
  /^POST \/v1\/me\/privacy-requests$/,
  /^(POST|PUT) \/v1\/privacy-requests(\/|$)/,
]

// The DPO decides and fulfils a data-subject request through its privacy case (B5): allowed for that case type only.
const CASE_ACTION = /^POST \/v1\/cases\/:id\//

export const tenantReadOnly = (): ApiError =>
  new ApiError(409, 'TENANT_READ_ONLY', 'This account is being offboarded or is archived: you can read and export, not change data.')

async function isPrivacyCase(request: FastifyRequest): Promise<boolean> {
  const { id } = request.params as { id?: string }
  if (id === undefined || !/^[0-9a-f-]{36}$/i.test(id)) return false
  const { rows } = await inTenant(request, (tx) => tx.query("SELECT 1 FROM case_file WHERE id = $1 AND type = 'privacy'", [id]))
  return rows.length > 0
}

/** 409 TENANT_READ_ONLY for a write of a read-only tenant outside the allowlist; sessions, API keys and webhooks call it. */
export async function assertTenantWritable(request: FastifyRequest, readOnly: boolean): Promise<void> {
  if (!readOnly || READ_METHODS.has(request.method)) return
  const route = `${request.method} ${request.routeOptions.url ?? request.url}`
  if (READ_ONLY_ALLOWLIST.some((allowed) => allowed.test(route))) return
  if (CASE_ACTION.test(route) && request.auth?.realm === 'tenant' && (await isPrivacyCase(request))) return
  throw tenantReadOnly()
}

/** For routes that resolve the tenant themselves (signed webhooks, after the signature): the state read in their tx. */
export async function assertTenantWritableIn(tx: Tx, request: FastifyRequest, tenantId: string): Promise<void> {
  const { rows } = await tx.query<{ read_only: boolean }>('SELECT tenant_read_only($1) AS read_only', [tenantId])
  await assertTenantWritable(request, rows[0]!.read_only)
}

/** onRequest after session resolution: tenant and portal sessions of a read-only tenant write nothing (D-V1A-07). */
export function registerTenantReadOnlyGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    await assertTenantWritable(request, request.auth?.tenantReadOnly === true)
  })
}
