import { closePool } from '@nmp/db'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { startWorkers } from './lib/jobs.js'
import { defaultModules } from './modules/index.js'

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const app = await buildApp({ config })
  const workers = await startWorkers({
    config,
    log: app.log,
    jobs: defaultModules.flatMap((module) => module.jobs ?? []),
  })
  await app.listen({ host: config.host, port: config.port })

  // Graceful close: stop taking requests, let running jobs finish, then release database connections.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    await workers.stop()
    await closePool()
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      shutdown(signal).catch((error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed')
        process.exitCode = 1
      })
    })
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`API failed to start: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
