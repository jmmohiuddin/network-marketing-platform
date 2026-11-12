# qa — OPEN_ISSUES

_Agent: qa. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## 2026-11-12 — packages/compliance review findings (all verified by probe)
- MEDIUM r4.ts: `activePvMinor: null` at runtime (e.g. unset JSON setting) is treated as threshold 0 — every earner with an order becomes active, nothing omitted. Null `personalShareFlag` / `rankThresholdsPvMinor` throw raw TypeError. validateConfig does not check types or negative thresholds.
- MEDIUM r4.ts: same-day orders tie-break by orderRef, prototype by file order. `of_which_refunded_later` and the crossing drill id differ when ids are not in file order (file [O2 4000, O1 2000 refunded], day 28: prototype 1/1, package 1/0). Fact table has no row sequence; method text does not state the tie-break.
- LOW r5.ts: payout lines to payees outside the R5 population (non-earning type, or ref not in participants) are dropped silently; R5 total no longer reconciles to R3 and no note says so.
- LOW r5.ts/r3.ts: partial-year label lives only on ReportPeriod; every Figure.note is null, while spec 5.1 puts the partial-year text in compliance_figure.note. R5 is also emitted for a year with zero payout lines (0.00 % earners, mean 0.00).
- LOW golden.test.ts: R5 population assertion is vacuous (`typeof population === 'string'`); R2 has no figure-count check.

## 2026-11-12 — T-A07 observations (not registered as bugs)
- Catalogue question (E-ADR-09): SDD-10 gives Tenant admin "full" on Audit log, but audit export needs audit.read + export and Tenant admin lacks export. Product to confirm.
- By design, pinned by the suites: a vendor without session sees support-session metadata incl. decided_by (a tenant admin's user id) and breach contacts; in a session the vendor cannot download the tenant's audit exports (requester-only, 404) and cannot use vendor routes while sending X-Support-Session (REALM_FORBIDDEN, logged).
- Not covered by TS-21 here: job/outbox payload namespacing and upload paths (SEC-29), timing side channels, API keys (rel B). Rel-B routes must add cases when they land.
