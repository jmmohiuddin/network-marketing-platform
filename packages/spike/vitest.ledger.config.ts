import { defineConfig } from 'vitest/config'
// Own config and *.int.ts suffix: the root suite (packages/*/test/**/*.test.ts) must never pick these up,
// because they reset schemas in the disposable nmp_spike database. Run: vitest run --config packages/spike/vitest.ledger.config.ts
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['test/ledger/**/*.int.ts'],
    pool: 'forks', poolOptions: { forks: { singleFork: true } }, fileParallelism: false, testTimeout: 60000,
  },
})
