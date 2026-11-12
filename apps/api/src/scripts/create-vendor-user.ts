// Operator bootstrap of a vendor user (BUG-031), run on the server:
//   pnpm --filter @nmp/api create-vendor-user --email ops@vendor.example [--name "Ada Ops"] [--i-understand]
// Vendor users invited in the product need an independent second vendor user's approval; the first ones come only
// from the seed (local databases) or from this script. It prints a one-time password-set link once and mails nothing.
// Outside a local database (nmp_dev/nmp_test/nmp_e2e over a socket or loopback) it runs only with --i-understand AND
// NMP_ALLOW_VENDOR_BOOTSTRAP=yes, whatever NODE_ENV says. Refused once two usable vendor users exist.
import { closePool, type Tx } from '@nmp/db'
import { hostname, userInfo } from 'node:os'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { loadConfig, type Config } from '../config.js'
import { runInVendor, SYSTEM_ACTOR_ID } from '../lib/db.js'
import { bootstrapVendorUser } from '../modules/iam/index.js'
import { isLocalDatabase, type SeedTarget } from '../seed.js'

export const PRODUCTION_FLAG = '--i-understand'
export const PRODUCTION_ENV = 'NMP_ALLOW_VENDOR_BOOTSTRAP'

const args = z.object({
  email: z.email().max(320).transform((email) => email.toLowerCase()),
  displayName: z.string().trim().min(1).max(200).nullable(),
  iUnderstand: z.boolean(),
})
export type BootstrapArgs = z.infer<typeof args>

/** --email <address> (required), --name <display name>, --i-understand. */
export function parseArgs(argv: readonly string[]): BootstrapArgs {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  return args.parse({ email: valueOf('--email'), displayName: valueOf('--name') ?? null, iUnderstand: argv.includes(PRODUCTION_FLAG) })
}

/**
 * Anything but a local database, or NODE_ENV=production, needs both the flag and the environment variable, so neither a
 * typo nor a copied command is enough. The target is the database actually connected to, not NODE_ENV alone.
 */
export function assertBootstrapAllowed(env: Config['env'], target: SeedTarget, iUnderstand: boolean, envValue: string | undefined): void {
  if (env !== 'production' && isLocalDatabase(target)) return
  if (!iUnderstand || envValue !== 'yes') {
    throw new Error(`refusing to create a vendor user in ${target.database} at ${target.serverAddress ?? 'a local socket'} without ${PRODUCTION_FLAG} and ${PRODUCTION_ENV}=yes`)
  }
}

async function connectedTarget(tx: Tx): Promise<SeedTarget> {
  const { rows } = await tx.query<SeedTarget>('SELECT current_database() AS database, host(inet_server_addr()) AS "serverAddress"')
  return rows[0]!
}

/** Checks the target, then creates the vendor user as the system actor (logged in the vendor log with who ran it). */
export function createVendorUser(
  config: Config, input: BootstrapArgs, envValue: string | undefined = process.env[PRODUCTION_ENV],
): Promise<{ userId: string; link: string }> {
  const actor = { actorType: 'system' as const, requestId: 'create-vendor-user', supportSessionId: null }
  const operator = { osUser: userInfo().username, host: hostname() }
  return runInVendor(SYSTEM_ACTOR_ID, actor, async (tx) => {
    assertBootstrapAllowed(config.env, await connectedTarget(tx), input.iUnderstand, envValue)
    return bootstrapVendorUser(tx, config, { email: input.email, displayName: input.displayName, operator })
  })
}

async function main(): Promise<void> {
  const input = parseArgs(process.argv.slice(2))
  const config = loadConfig(process.env)
  const created = await createVendorUser(config, input)
  // Printed once, after commit; only its hash is stored. The user enrols MFA at first sign-in.
  process.stdout.write(`vendor user ${input.email} created (${created.userId}). One-time password link:\n${created.link}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error: unknown) => {
      process.stderr.write(`create-vendor-user failed: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
    .finally(() => closePool())
}
