// Tenant purge (FR-TEN-005, D-V1A-07), run by the operator once a second, independent vendor user approved it:
//   pnpm --filter @nmp/api purge-tenant -- --tenant <id> --slug <slug>
// Owner connection MIGRATE_DATABASE_URL (a superuser or a role granted SET ON PARAMETER session_replication_role):
// SQL tenant_purge deletes every row of the tenant (it refuses a wrong slug, an unapproved purge, a retention not yet
// passed or an active legal hold), the vendor log records it, then the tenant's upload directory is removed.
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { closePool, type Tx } from '@nmp/db'
import { closeOwnerPool, getOwnerPool } from '@nmp/db/testing'
import { z } from 'zod'
import { recordVendorAudit } from '../lib/audit.js'

// UPLOAD_DIR as the API resolves it (aud/document-store.ts, imp/options.ts): relative to apps/api, default var/uploads.
const API_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const uploadDir = (): string => resolve(API_ROOT, z.string().min(1).default('var/uploads').parse(process.env.UPLOAD_DIR))

const args = z.object({ tenant: z.uuid(), slug: z.string().min(1).max(63) })
export type PurgeArgs = z.infer<typeof args>

/** --tenant <id> --slug <slug> (both required: the slug is typed to confirm which tenant goes). */
export function parseArgs(argv: readonly string[]): PurgeArgs {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  return args.parse({ tenant: valueOf('--tenant'), slug: valueOf('--slug') })
}

const REFUSALS: Readonly<Record<string, string>> = {
  '22023': 'the slug does not name this tenant',
  '55000': 'the purge is not approved, the retention has not passed, or a legal hold is active',
}

async function assertMaySetReplicationRole(tx: Tx): Promise<void> {
  const { rows } = await tx.query<{ allowed: boolean }>(
    `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) OR has_parameter_privilege('session_replication_role', 'SET') AS allowed`,
  )
  if (!rows[0]!.allowed) throw new Error('the owner connection may not set session_replication_role (superuser or SET ON PARAMETER needed)')
}

/** Purges the tenant in one owner transaction (vendor log TENANT.PURGED with its approvers), then its uploads. */
export async function purgeTenant(input: PurgeArgs, uploadDir: string): Promise<unknown> {
  const tx = await getOwnerPool().connect()
  let summary: unknown
  try {
    await tx.query('BEGIN')
    await assertMaySetReplicationRole(tx)
    const { rows: approvers } = await tx.query<{ purge_requested_by: string; purge_approved_by: string }>(
      `SELECT purge_requested_by, purge_approved_by FROM tenant_offboarding WHERE tenant_id = $1 AND state = 'purge_approved'`, [input.tenant],
    )
    try {
      summary = (await tx.query<{ summary: unknown }>('SELECT tenant_purge($1, $2) AS summary', [input.tenant, input.slug])).rows[0]!.summary
    } catch (error) {
      const refusal = REFUSALS[(error as { code?: string }).code ?? '']
      throw refusal === undefined ? error : new Error(`refused: ${refusal}`)
    }
    // The vendor log's actor columns come from the transaction context (lib/audit.ts): the platform, not a person.
    await tx.query(`SELECT set_config('app.realm', 'vendor', true), set_config('app.tenant_id', '', true),
                           set_config('app.actor_type', 'system', true), set_config('app.request_id', 'purge-tenant', true)`)
    await recordVendorAudit(tx, {
      action: 'TENANT.PURGED', objectType: 'tenant', objectId: input.tenant,
      after: { summary, purge_requested_by: approvers[0]?.purge_requested_by, purge_approved_by: approvers[0]?.purge_approved_by },
    })
    await tx.query('COMMIT')
  } catch (error) {
    await tx.query('ROLLBACK')
    throw error
  } finally {
    tx.release()
  }
  // After the commit: files are not transactional; a failure here leaves files only, and a re-run of rm finishes it.
  await rm(join(uploadDir, input.tenant), { recursive: true, force: true })
  return summary
}

async function main(): Promise<void> {
  const input = parseArgs(process.argv.slice(2))
  const summary = await purgeTenant(input, uploadDir())
  process.stdout.write(`tenant ${input.slug} (${input.tenant}) purged: ${JSON.stringify(summary)}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error: unknown) => {
      process.stderr.write(`purge-tenant failed: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
    .finally(async () => {
      await closeOwnerPool()
      await closePool()
    })
}
