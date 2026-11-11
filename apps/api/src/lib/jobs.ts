import type { Tx } from '@nmp/db'
import type { FastifyBaseLogger } from 'fastify'
import PgBoss from 'pg-boss'
import { z } from 'zod'
import type { Config } from '../config.js'
import { runInTenant, SYSTEM_ACTOR_ID } from './db.js'

const POLLING_INTERVAL_SECONDS = 2
const STOP_TIMEOUT_MS = 10_000

export interface JobContext {
  readonly jobId: string
  readonly log: FastifyBaseLogger
  readonly config: Config
}

/** What a worker gives every job besides its id. */
export type WorkerContext = Omit<JobContext, 'jobId'>

/** A job as stored by pg-boss: its id and data ({ tenantId, payload } for tenant jobs). */
export interface QueuedJob {
  readonly id: string
  readonly data: unknown
}

/** A job that works on one tenant's data. It runs inside withTenant for the tenant it was enqueued from. */
export interface TenantJob<P> {
  readonly scope: 'tenant'
  readonly name: string
  readonly payload: z.ZodType<P>
  run(tx: Tx, payload: P, ctx: JobContext): Promise<void>
}

/** A platform job without tenant context (for example a fan-out that enqueues one tenant job per tenant). */
export interface SystemJob {
  readonly scope: 'system'
  readonly name: string
  /** Cron expression (UTC) when the job runs on a schedule. */
  readonly cron?: string
  run(ctx: JobContext): Promise<void>
}

export type JobDefinition = TenantJob<unknown> | SystemJob

export function defineTenantJob<P>(job: Omit<TenantJob<P>, 'scope'>): TenantJob<P> {
  return { ...job, scope: 'tenant' }
}

export function defineSystemJob(job: Omit<SystemJob, 'scope'>): SystemJob {
  return { ...job, scope: 'system' }
}

const envelopeSchema = z.object({ tenantId: z.uuid(), payload: z.unknown() })

/** pg-boss database adapter that runs its SQL in the caller's transaction. */
function inTransaction(tx: Tx): PgBoss.Db {
  return { executeSql: (text: string, values?: unknown[]) => tx.query(text, values) }
}

/**
 * Enqueues a tenant job in the caller's tenant transaction: the job exists only if the transaction commits.
 * The tenant id is read from the transaction (the session's tenant), never passed in by the caller.
 */
export async function enqueue<P>(tx: Tx, job: TenantJob<P>, payload: P): Promise<string> {
  const { rows } = await tx.query<{ tenant_id: string | null }>('SELECT app_tenant_id() AS tenant_id')
  const tenantId = rows[0]?.tenant_id ?? null
  if (tenantId === null) throw new Error(`enqueue(${job.name}) needs a tenant transaction`)
  const boss = new PgBoss({ db: inTransaction(tx), migrate: false, schedule: false, supervise: false })
  await boss.createQueue(job.name) // no-op when the queue exists (pgboss.create_queue, migration 0008)
  const id = await boss.send(job.name, { tenantId, payload: job.payload.parse(payload) })
  if (id === null) throw new Error(`enqueue(${job.name}) was not accepted by the queue`)
  return id
}

export interface Workers {
  stop(): Promise<void>
}

/** Runs one queued tenant job inside withTenant for the tenant it was enqueued from, as the system actor. */
export async function runTenantJob(job: TenantJob<unknown>, raw: QueuedJob, worker: WorkerContext): Promise<void> {
  const data = envelopeSchema.parse(raw.data)
  const payload = job.payload.parse(data.payload)
  const actor = { actorType: 'system' as const, requestId: raw.id, supportSessionId: null }
  await runInTenant({ tenantId: data.tenantId, userId: SYSTEM_ACTOR_ID }, actor, (tx) =>
    job.run(tx, payload, { ...worker, jobId: raw.id }),
  )
}

async function register(boss: PgBoss, job: JobDefinition, worker: WorkerContext): Promise<void> {
  await boss.createQueue(job.name)
  await boss.work(job.name, { batchSize: 1, pollingIntervalSeconds: POLLING_INTERVAL_SECONDS }, async ([raw]) => {
    if (raw === undefined) return
    const context = { ...worker, log: worker.log.child({ job: job.name, jobId: raw.id }) }
    if (job.scope === 'tenant') await runTenantJob(job, raw, context)
    else await job.run({ ...context, jobId: raw.id })
  })
  if (job.scope === 'system' && job.cron !== undefined) await boss.schedule(job.name, job.cron, undefined, { tz: 'UTC' })
}

/** Starts pg-boss (schema from migration 0008, checked not migrated) and one worker per job definition. */
export async function startWorkers(options: {
  config: Config
  log: FastifyBaseLogger
  jobs: readonly JobDefinition[]
}): Promise<Workers> {
  const { config, log } = options
  const boss = new PgBoss({ connectionString: config.databaseUrl, max: config.jobPoolSize, migrate: false })
  boss.on('error', (error: Error) => log.error({ err: error }, 'job queue error'))
  await boss.start()
  for (const job of options.jobs) await register(boss, job, { config, log })
  return { stop: () => boss.stop({ graceful: true, wait: true, timeout: STOP_TIMEOUT_MS }) }
}
