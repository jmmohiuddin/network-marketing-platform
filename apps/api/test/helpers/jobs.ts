import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fastify from 'fastify'
import { runTenantJob, type TenantJob } from '../../src/lib/jobs.js'
import { TEST_MAIL_DIR, testConfig } from './app.js'
import { ownerRows } from './users.js'

/**
 * Runs the queued jobs of one tenant job type now, as a worker would, and takes them off the queue (no
 * workers run in API tests). Returns how many ran.
 */
export async function runQueuedJobs(job: TenantJob<unknown>): Promise<number> {
  const queued = await ownerRows<{ id: string; data: unknown }>(
    `SELECT id, data FROM pgboss.job WHERE name = $1 AND state = 'created' ORDER BY created_on, id`,
    [job.name],
  )
  const worker = { config: testConfig(), log: fastify({ logger: false }).log }
  for (const raw of queued) {
    await runTenantJob(job, raw, worker)
    await ownerRows(`UPDATE pgboss.job SET state = 'completed', completed_on = now() WHERE name = $1 AND id = $2`, [job.name, raw.id])
  }
  return queued.length
}

/** Every mail delivered to an address in this test run, oldest first. */
export async function mailsTo(address: string): Promise<string[]> {
  const names = (await readdir(TEST_MAIL_DIR).catch(() => [] as string[])).sort()
  const mails = await Promise.all(names.map((name) => readFile(join(TEST_MAIL_DIR, name), 'utf8')))
  return mails.filter((mail) => mail.split('\r\n').includes(`To: ${address}`))
}

/** The invitation token in an invitation mail. */
export function invitationToken(mail: string): string {
  const match = /#token=([\w-]+)/.exec(mail)
  if (match === null) throw new Error('no invitation link in the mail')
  return match[1]!
}
