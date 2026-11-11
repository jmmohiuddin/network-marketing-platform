import { defineConfig } from 'vitest/config'
// One worker: integration tests share one Postgres database, and the machine has 16 GB.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'apps/api/src/**/*.test.ts', 'apps/api/test/**/*.test.ts'],
    pool: 'forks', poolOptions: { forks: { singleFork: true } },
    fileParallelism: false, testTimeout: 30000,
    env: { NODE_ENV: 'test', DATABASE_URL: 'postgres://nmp_app:nmp_app_local@127.0.0.1:5432/nmp_test', MIGRATE_DATABASE_URL: 'postgres://127.0.0.1:5432/nmp_test' },
  },
})
