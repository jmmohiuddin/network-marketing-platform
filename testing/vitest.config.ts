import { defineConfig } from 'vitest/config'
// Harness unit tests only; the root config covers apps/ and packages/.
export default defineConfig({ test: { root: import.meta.dirname, include: ['**/*.test.ts'] } })
