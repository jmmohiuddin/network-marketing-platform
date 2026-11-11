# qa — MEMORY

_Agent: qa. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


- 2026-11-12: `@nmp/compliance` reviewed. Matches report.json and the prototype under fuzz. Scratch harness pattern: copy prototype to scratchpad, run `python3 -I`, drive the package with `pnpm exec tsx <script>.mts` importing `packages/compliance/src/index.ts` by absolute path. Figures hold bigint, so `JSON.stringify(result)` throws — callers must convert.
