# qa — COMPLETED_TASKS

_Agent: qa. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## 2026-11-12 — Adversarial review of packages/compliance (T-A10), read-only
- Read all src + tests; ran `pnpm vitest run packages/compliance` (98 pass) and `tsc --noEmit` (clean).
- Re-ran analytics.py on a scratch copy: output identical to shipped report.json.
- Differential fuzz: 400 random datasets, 47,556 figures, package vs prototype (pct swapped for exact half-up) + own exact R5: 0 differences (order ids generated in file order).
- No source changed. Findings in OPEN_ISSUES.md.

## 2026-11-12 — T-A07 (TS-21 isolation, TS-36 role matrix)
- Created apps/api/test/isolation/{route-registry,seed,cases}.ts + isolation.test.ts (319 tests) and apps/api/test/authz/role-matrix.test.ts (29 tests). No production code changed.
- Isolation: 53 routes + 24 HEAD twins x {no session -> 401 (public: same as phantom), tenant-B all-permission user -> 404 identical to unknown id / own rows only / REALM_FORBIDDEN on vendor routes, vendor without session -> REALM_FORBIDDEN + NO_SESSION vendor log + no business canary, vendor in approved session -> reads 200 + ACCESSED logged, writes SUPPORT_SESSION_READ_ONLY in both logs}; coverage guard both ways; fingerprint of every tenant-A row unchanged; cross-references (A's role, market, mapping from B) answered as unknown; Idempotency-Key not replayed across tenants; per-tenant ETag/version counters.
- Matrix: 11 base roles x every route (91 probes per role: 62 + 29 HEAD; 5 setting keys each for GET/PUT, export=true variant), side-effect-free probes; SEC-27/BR-SEC-05 grant table; AC-36.2 market scope on imports and snapshots.
- Bugs: no new defect; BUG-006/007 got it.fails regression tests (register updated).
