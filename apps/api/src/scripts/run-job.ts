// Runs one registered system cron once, through the same handler the schedule calls (PLAN V1-A §2.8; QA uses it for
// led.credits.expire, prv.retention.apply, cpl.grievances.escalate):
//   pnpm --filter @nmp/api run-job -- <job name>
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { closePool } from '@nmp/db'
import fastify from 'fastify'
import { loadConfig, type Config } from '../config.js'
import type { SystemJob, WorkerContext } from '../lib/jobs.js'
import type { ApiModule } from '../lib/module.js'
import { defaultModules } from '../modules/index.js'

/** The system crons the modules register, by name. */
export function systemCrons(modules: readonly ApiModule[]): ReadonlyMap<string, SystemJob> {
  const jobs = modules.flatMap((module) => module.jobs ?? [])
  return new Map(jobs.filter((job): job is SystemJob => job.scope === 'system' && job.cron !== undefined).map((job) => [job.name, job]))
}

/** Runs the named cron once; an unknown name is refused with the list of known ones. */
export async function runJob(name: string, modules: readonly ApiModule[], worker: WorkerContext): Promise<void> {
  const crons = systemCrons(modules)
  const job = crons.get(name)
  if (job === undefined) throw new Error(`unknown system cron "${name}"; known: ${[...crons.keys()].sort().join(', ')}`)
  await job.run({ ...worker, jobId: randomUUID() })
}

async function main(): Promise<void> {
  const name = process.argv.slice(2).find((arg) => arg !== '--')
  if (name === undefined) throw new Error('name the job: run-job <job name>')
  const config: Config = loadConfig(process.env)
  const log = fastify({ logger: { level: config.logLevel } }).log
  await runJob(name, defaultModules, { config, log })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error: unknown) => {
      process.stderr.write(`run-job failed: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
    .finally(() => closePool())
}
