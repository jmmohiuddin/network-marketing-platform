# qa — MEMORY

_Agent: qa. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


- 2026-11-12: `@nmp/compliance` reviewed. Matches report.json and the prototype under fuzz. Scratch harness pattern: copy prototype to scratchpad, run `python3 -I`, drive the package with `pnpm exec tsx <script>.mts` importing `packages/compliance/src/index.ts` by absolute path. Figures hold bigint, so `JSON.stringify(result)` throws — callers must convert.
- 2026-11-12 T-A07: TS-21 isolation + TS-36 matrix suites exist (apps/api/test/isolation, apps/api/test/authz).
  - Route enumeration: `vi.mock('fastify', async (o) => (await import('<rel>/isolation/route-registry.js')).collecting(await o()))` at the top of a test file, then `routesOf(app)` after `buildTestApp()`; the onRoute hook sees every route (HEAD twins included). Build the app at module top level (top-level await) so `test.each(routes)` has data at collection time; seed in beforeAll.
  - A new route MUST get a case in test/isolation/cases.ts (access public|self|tenant|vendor|either, shape object|collection|own) and probes in test/authz/role-matrix.test.ts PROBES, or both suites fail. HEAD routes reuse the GET case/probes.
  - test/isolation/seed.ts `seedTenants(app)`: tenant A with one object of every type via the real API (settings v1-5 incl. breach contact canary, invitee, tenant role, assignment, pending privileged grant request, approved mapping, loaded + rejected batch in market TINY, ready snapshot + figure, audit export, approved support session of a vendor), empty tenant B, `phantomOf(targets)`, `canariesOf(tenant)` (all row ids + emails), `fingerprintOf(tenant, schemas)` (md5 per tenant table). Needs `vi.stubEnv('UPLOAD_DIR', tmp)` before buildTestApp and env API_RATE_LIMIT_PER_MINUTE / SIGN_IN_RATE_LIMIT_PER_MINUTE raised.
  - test.fails documents open bugs (BUG-006, BUG-007) in authz; flip to test when fixed.
