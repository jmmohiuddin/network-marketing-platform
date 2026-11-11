# compensation — MEMORY

_Agent: compensation. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## 2026-11-12 — T-A10 @nmp/compliance (pure R1–R5)
- Package `packages/compliance` is done and green: `pnpm vitest run packages/compliance` (98 tests), `tsc --noEmit -p packages/compliance/tsconfig.json` clean. No dependencies, no I/O.
- Entry: `computeReports(facts, config, options?)` → `{ methodVersion, months, years, reports: ReportPeriod[] }`. `ReportPeriod = { report, period ('YYYY-MM' | 'YYYY'), periodKind, partial, figures, omitted[{key,reason}], notes }`. Figure keys are the prototype JSON keys (`customer_share_pct`, `share_pct.retail_sale`, `bands.0 or less`), so they map 1:1 to `compliance_figure.key`.
- `Figure.value` is always a decimal string or null ("62.50", "16000", "14.30"); `numerator`/`denominator` are bigint (callers must serialise). `METHOD_VERSION = 'cpl-method-1.0.0'`.
- Facts use `'YYYY-MM'` month strings + `orderDay: number | null`; the caller converts `order_date`/`pay_month`/`enrolled_month` dates.
- See TECHNICAL_DECISIONS.md and OPEN_ISSUES.md for the choices a caller must know.
