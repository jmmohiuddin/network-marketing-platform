import { defineConfig } from 'vitest/config'
// One worker: integration tests share one Postgres database, and the machine has 16 GB.
// Parallel agents each set NMP_TEST_DB=nmp_test_<slot> so their test runs never share a database.
const TEST_DB = process.env.NMP_TEST_DB ?? 'nmp_test'
if (!/^nmp_test(_[1-4])?$/.test(TEST_DB)) throw new Error(`NMP_TEST_DB must be nmp_test or nmp_test_1..4, got ${TEST_DB}`)

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'apps/api/src/**/*.test.ts', 'apps/api/test/**/*.test.ts',
      // Web tests run in node unless the file starts with `// @vitest-environment jsdom`.
      'apps/web/src/**/*.test.{ts,tsx}'],
    pool: 'forks', poolOptions: { forks: { singleFork: true } },
    fileParallelism: false, testTimeout: 30000,
    env: { NODE_ENV: 'test', DATABASE_URL: `postgres://nmp_app:nmp_app_local@127.0.0.1:5432/${TEST_DB}`, MIGRATE_DATABASE_URL: `postgres://127.0.0.1:5432/${TEST_DB}` },
  },
})
