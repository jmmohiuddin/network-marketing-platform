# frontend — COMPLETED_TASKS

_Agent: frontend. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


- 2026-11-12 T-A13: apps/web foundation: tokens (light + dark), base styles, component set, API client with auth/step-up handling, staff and vendor shells, tenant + vendor sign-in, MFA enrolment + verification, step-up dialog, invitation accept, sign-out, role home, 403/404. 81 web tests; next build OK.
- 2026-11-12 T-A15: imports + compliance screens (SC-24, SC-25, SC-10, SC-26) under `features/data/` and `app/(staff)/{imports,compliance}`; 30 tests in features/data (web suite 129 green), tsc clean for my files.
- 2026-11-12 T-A14: admin + vendor console: users/roles/grants/approvals (SC-28), vendor access (SC-14), audit log with export + chain verification (SC-30), tenant settings (thresholds without defaults, breach contacts), vendor tenants list/detail/provisioning/go-live/support sessions (SC-39). 44 tests.
- 2026-11-12 Review fixes R1 (17 findings): SC-46 overview at /compliance (list moved to /compliance/snapshots), support-session mode (X-Support-Session on GETs, frame, read-only UI, "Open tenant app"), light-only theme, nonce CSP proxy, shared lib/use-resource + lib/use-now, FormDialog-owned Idempotency-Key, market id shown, invitation ?tenant= prefill, permission matrix + diff, compare-periods table, section error states, dead code removed. 34 files / 177 tests; tsc + next build green.

