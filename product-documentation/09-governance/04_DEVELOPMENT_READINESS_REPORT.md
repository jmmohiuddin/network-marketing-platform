# 04 — DEVELOPMENT READINESS REPORT
## Final audit of the documentation set and the readiness gate

| Field | Value |
|---|---|
| Document ID | GOV-04 |
| Version | 0.1 |
| Last updated | 2026-11-12 |
| Owner | Founder; CPO and CTO roles |
| Depends on | Every document in the set |
| Status | Draft for founder review |

## 1. Verdict

| Scope | Verdict |
|---|---|
| **The product as a whole** | **Not development-ready.** The documentation is now complete enough to build from, but the decisions and evidence the build depends on are missing: no buyer demand evidence, no launch market, no provider confirmation, no tax or legal advice, no performance proof, no user testing, no independent review |
| **MVP-A (compliance-analytics overlay)** | **Ready to build once three items are in place:** a design partner or at least the demand-test rule confirmed (FD-08, FD-10); data terms reviewed by counsel; a data region chosen. It is small (18 requirements), its report logic is already prototyped and hand-checked, and it is the test that decides everything else |
| **MVP-B (engine plus compliance)** | **Specified, not ready.** Must not start before the Phase B gate and the Phase C spike. Blockers are listed in §5 |
| **Self-hosted edition** | **Specified at requirement level only** (V1). Architecture constraints are in place so it stays cheap; pricing and liability are open |
| **India market pack** (PD-04) | **Drafted, not releasable.** Every item is Sourced or To decide; none Confirmed by Indian counsel or a chartered accountant |
| **Bangladesh** | **No MLM pack** (DEC-20). Affiliate pack only after counsel (AQ-13) |

Declaring the whole product development-ready would be false. What can honestly be said: **the product is defined, the unknowns are named, and the next build step (MVP-A) is small and specified.**

## 2. What was produced

| Measure | Count |
|---|---|
| Documents | 51 Markdown documents in 10 folders (plus a README for the generator source), 42 wireframe files, a verification script with its output and a machine-readable trace file |
| Functional requirements | 122 (MVP-A 18 · MVP-B 81 · market-pack 4 · V1 19) in 23 modules |
| User stories / acceptance criteria | 58 / 102 |
| Business rules | 119, each with basis and status; unresolved rules listed separately |
| Screens | 47 inventoried; 34 drawn as low-fidelity wireframes plus 8 phone variants |
| API endpoints (catalogue) | 41, with 11 representative specifications |
| Database tables | 75 with columns, keys, constraints, indexes, ownership and audit; 7 generated ER diagrams |
| Test scenarios / edge cases | 71 / 112 |
| Diagrams | Architecture, ER, sequence, state, flow and user-journey diagrams in Mermaid, each rendered successfully |
| Calculation checks | 55 of 55 expected values verified by script |

## 3. Cross-document consistency audit

Checks run by script over the whole set on 12 November 2026:

| Check | Result |
|---|---|
| Every requirement, story, criterion, rule, test, screen and API ID cited anywhere exists in its home document | Pass: no unknown ID |
| Every decision, architecture decision, open question and journey ID cited is defined | Pass |
| Every file link and image reference resolves | Pass |
| Every Mermaid diagram renders | Pass |
| Requirements without screens; screens without requirements | 0; 0 |
| APIs without a requirement; entities without a requirement; stories without a requirement | 0; 0; 0 |
| Acceptance criteria without a test | 0 |
| Requirements without acceptance criteria | **15**: 14 V1 requirements and FR-CPL-013 (market-pack registers) |
| Business rules without a test | **13**: V1 rules, the two-edition rule BR-LIC-05, and two rules whose content is unresolved (BR-REV-02, BR-TAX-04) |
| Every requirement appears in the roadmap | Pass |

**The contradictions the brief asked to detect:**

| Possible contradiction | Finding |
|---|---|
| PRD requires multiple compensation plans, database supports one | Consistent: `plan` → `plan_version` → `plan_rule`; several plans per tenant; one version per run |
| PRD requires historical genealogy, design has no history model | Consistent: bitemporal `relationship`; as-of and known-at queries; replay test |
| UX requires role-specific dashboards, authorisation cannot support them | Consistent: navigation generated from permissions; RBAC plus attribute scopes; role matrix test |
| UI contains a button with no business action | Each drawn primary and secondary action maps to a requirement in the inventory; 13 screens are not drawn, so their controls are specified in text only |
| SDD defines an API with no user workflow | None: every catalogue endpoint lists its requirements |
| Financial requirements demand reversals, model supports only deletion | Consistent: append-only postings; reversals are new entries; clawback receivable; no delete privilege |
| Mobile requirements exist, no mobile layouts documented | Consistent for the distributor portal (8 phone wireframes; rules in WF-06, UI-05). **Limit:** staff screens have no phone layouts except read-and-approve behaviour described in text |

**Inconsistencies found and corrected during the audit:** summary counts in the edge-case and QA documents were corrected to the generated totals; ledger account types were aligned between the financial design and the database design; Mermaid syntax errors in seven diagrams were fixed.

**Known internal tensions that remain (recorded, not hidden):**

1. The documentation specifies MVP-B in detail although the research says the engine should not be built before demand is shown. This is deliberate (the brief asked for a complete blueprint) and the gate is stated wherever it matters.
2. The self-hosted edition is a founder decision that the research did not study; the research's only statement on licences is negative for one-time licences. Recorded as conflict C-13 with open questions on pricing and liability.
3. Persona-driven requirements rest on hypotheses; six of seven personas have no evidence.

## 4. Readiness gate

### 4.1 Product readiness

| Criterion | Status | Evidence | What remains |
|---|---|---|---|
| Product scope is clear | **Met** | PD-03; PRD-01 §4; founder choices DEC-01, DEC-02, DEC-17 | Confirmation by buyer evidence |
| Target users are defined | **Partly** | PRD-01 §3 | Six of seven personas are hypotheses; no interviews |
| Business objectives are measurable | **Partly** | PD-01 §3; PRD-01 §11 | Several targets need the founder (FD-03) or a baseline from a first tenant |
| Functional requirements are complete | **Met for MVP-A and MVP-B** | PRD-02 | 14 V1 requirements and FR-CPL-013 lack acceptance criteria |
| Business rules are documented | **Partly** | PRD-04; reconstruction 15-R | About 22 rules of the original catalogue remain lost after reconstruction (OQ-22); legal, tax and reversal rules unresolved; India values sourced but not confirmed (PD-04) |
| MVP is realistic | **MVP-A: yes. MVP-B: unknown** | PRD-07 | MVP-B size against an unknown team (FD-03) |

### 4.2 Technical readiness

| Criterion | Status | Evidence | What remains |
|---|---|---|---|
| Architecture is documented | **Met** | SDD-01, -02, -03, -10, -11 | Independent review; spike |
| Database is designed | **Met** | SDD-04, -05 | Review; migration scripts are build work |
| API contracts are specified | **Partly** | SDD-06; TRD-03 | 11 representative specifications; a full OpenAPI document for 41 endpoint groups is not written |
| Security requirements are defined | **Met** | TRD-04; SDD-10 | Independent security review; penetration test later |
| Integrations are understood | **Partly** | TRD-05; research 72 | **No provider has confirmed eligibility or capabilities**; India: two providers bar "MLM collection fees", others silent; Bangladesh: bKash corporate disbursement exists, eligibility unknown |
| Technical dependencies are identified | **Partly** | TRD-02 | Stack is provisional until team skills are known and the spike is run; cloud regions to verify |
| Performance is proven | **Not met** | PRD-03 targets are proposals | Phase C benchmark |

### 4.3 UX and UI readiness

| Criterion | Status | Evidence | What remains |
|---|---|---|---|
| Information architecture is complete | **Met** | UX-02, UX-03 | — |
| User journeys are documented | **Met** | UX-04 (18 journeys); reconstruction 10-R | Original journey steps J-01..J-17 are lost; subjects of 11 recovered and mapped to UX-04 |
| Screen inventory is complete | **Met** | WF-01 (47) | — |
| Wireframes exist for critical workflows | **Met at low fidelity** | 34 screens and 8 phone variants, including the five highest-risk screens | 13 screens text-only; not every state drawn; no clickable prototype |
| Component behaviour is defined | **Met as specification** | UI-04; UX-05 | Nothing built or tested |
| Responsive requirements are specified | **Met** | UI-05; WF-06 | Staff screens below 1024 px are not designed except approvals |
| Design validated with users | **Not met** | — | Usability and comprehension tests (UX-01 §7); brand and name (OQ-23); high-fidelity designs |

### 4.4 QA readiness

| Criterion | Status | Evidence | What remains |
|---|---|---|---|
| Acceptance criteria exist | **Met for MVP-A and MVP-B** | PRD-06 (102) | V1 items |
| Critical edge cases are covered | **Partly** | QA-03: 112 cases, 68 with a test, 39 to add, 5 open | Write the 39; resolve the 5 with counsel and the founder |
| Business calculations are testable | **Met** | QA-01 §5–§7; verification script | Golden datasets for corpus and tenant plans do not exist yet |
| Financial integrity is addressed | **Met as design** | SDD-09; QA-01 §8 | Prove in the ledger prototype (spike) |
| Security and permission testing is defined | **Met** | QA-01 §2; TS-21, 35–37, 42, 56 | Execute |

## 5. What must happen before MVP-B development starts

| # | Item | Owner | Reference |
|---|---|---|---|
| 1 | Decide the launch market, with your own access scored (Phase 2 recommends India, DEC-21) | Founder | FD-02 |
| 2 | State budget, team and revenue threshold | Founder | FD-03 |
| 3 | Written confirmation from at least two payout routes and a payment provider in that market (India letters listed in research 72 §4) | Founder with providers | AQ-01 |
| 4 | Tax adviser's answers on withholding and forms (India: confirm s.393 values, GST, 26Q layout) | Tax adviser | FD-05, AQ-12 |
| 5 | Counsel's answers on vendor exposure, payout design, residency, guardrails, reversals (India AQ-10, AQ-11; Bangladesh AQ-13) | Counsel | FD-04, FD-06 |
| 6 | Run the demand test with MVP-A and apply the pass/fail rule | Founder | FD-08, FD-10 |
| 7 | Independent review of the research audit and of this documentation | Reviewer | FD-07 |
| 8 | Technical spike: genealogy and engine benchmark, ledger prototype, isolation harness, five corpus plans configured | Engineering | OQ-05 |
| 9 | Human spot-check of the plan corpus; obtain plans from the launch market; set the coverage target | Founder | OQ-07, OQ-12 |
| 10 | Usability tests of the five highest-risk screens; statement comprehension test with distributors | UX | OQ-21 |
| 11 | Find the original three research documents (reconstructions exist; about 22 rules still lost) | Founder | OQ-22 |
| 12 | Build the market pack for the chosen market from items 4 and 5 | Product with advisers | — |

## 6. What can start now

1. Phase A items 1–5 above (decisions and advisers): no product needed.
2. **MVP-A build** (PRD-07 §2), in parallel with design-partner outreach.
3. The technical spike can be prepared (synthetic tree and order generators, golden-dataset format) without committing to MVP-B.

## 7. Risks of proceeding anyway

Building MVP-B before items 1–8 means: choosing tax, language and provider integrations by guess; sizing an engine with unproven performance; shipping guardrails without a legal basis; and spending the largest part of the budget before knowing whether anyone will pay. The research's stop triggers (PD-02 §3) exist to prevent exactly that.

## 8. Maintenance of this set

The structured documents (functional requirements, rules, stories, criteria, database, ER diagrams, screen inventory, tests, traceability) are generated from one source so their IDs cannot drift; `09-governance/traceability-data/spec.json` is the exported record. When a decision changes, update the source, regenerate, and re-run the consistency audit before approving a new version.

## 9. Phase 2 update (12 November 2026)

Desk research for Bangladesh and India was completed at screening grade (sibling folder `research-completion`, documents 07-R, 10-R, 15-R, 70–79). What it changes in this report:

| Area | Before | After |
|---|---|---|
| Launch market | Undecided, no market researched in depth | India recommended (DEC-21); Bangladesh MLM excluded (DEC-20); founder decision still needed |
| Missing research (OQ-22) | Three documents missing | Reconstructions; about 22 original rules still lost |
| Market pack | None | India pack drafted (PD-04), not releasable |
| Competitors | Marketing pages only | Documentation of three incumbents and two Indian vendors read; no compliance analytics stated; Indian price anchor $699–$5,399 one-time |
| Viability | No model | Illustrative model; viability depends on large Indian tenants and subscription acceptance |

**What it does not change:** no interviews, no written provider answers, no adviser opinions, no performance proof, no user testing. The overall verdict stands: **not development-ready as a whole; MVP-A buildable once a design partner, counsel's data review and a data region are in place** — the data region can now be the India cell.

