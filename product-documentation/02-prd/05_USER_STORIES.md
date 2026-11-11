# 05 — USER STORIES
## Stories with flows, tied to requirements and acceptance criteria

| Field | Value |
|---|---|
| Document ID | PRD-05 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Product (CPO role) |
| Depends on | PRD-02, PRD-06; gap audit 25 |
| Status | Draft. Not approved |

**Status.** Stories US-01 to US-34 come from the gap audit (25) and keep their IDs; US-35 to US-57 were added here for the overlay, access control, configuration and distributor portal. All are **hypotheses about needs** to be confirmed or cut by the Phase B interviews. Persona names follow `01_MASTER_PRODUCT_REQUIREMENTS_DOCUMENT.md` §3.


### US-01 — Commission analyst

**As a** commission analyst, **I want** to see the tree exactly as it was on any past date, **so that** I can explain a past payout after later corrections.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Reproducibility of paid history; faster dispute handling. |
| Preconditions | Relationship history exists; analyst has genealogy read. |
| Main flow | Open the genealogy explorer → search a position → set the as-of date → optionally set known-at → expand branches → open the run that used this tree. |
| Alternative flows | Read model rebuilding: depth-limited view from the system of record with a notice. |
| Acceptance criteria | AC-01.1, AC-01.2 |
| Requirements | FR-GEN-002, FR-GEN-003, FR-COMP-008 |
| Dependencies | FR-GEN-008 |

### US-02 — Support agent

**As a** support agent, **I want** to file a sponsor-change request with reason and evidence, **so that** changes are reviewed instead of edited directly.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Trail for every structural change. |
| Preconditions | Agent has case-create permission. |
| Main flow | Open the participant → choose Request genealogy change → pick change or correction → choose proposed parent → attach evidence → submit. |
| Alternative flows | Outside the plan's change window: rejected with the rule shown, or routed to the exception approver if the plan allows. |
| Acceptance criteria | AC-02.1, AC-02.2 |
| Requirements | FR-GEN-004, FR-CAS-001 |
| Dependencies | FR-CAS-001 |

### US-03 — Compliance officer

**As a** compliance officer, **I want** to approve or reject genealogy corrections and see which committed periods they affect, **so that** corrections do not silently change paid history.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Paid history changes only through an open, approved path. |
| Preconditions | Case awaiting review. |
| Main flow | Open the case → read evidence → review affected periods and estimated impact → approve or reject with reason → system applies rows and queues read-model rebuild. |
| Alternative flows | Affects committed periods: choose adjust in open period or raise a restatement request. |
| Acceptance criteria | AC-03.1, AC-03.2 |
| Requirements | FR-GEN-004 |
| Dependencies | FR-COMP-009 |

### US-04 — Distributor

**As a** distributor, **I want** to hold several positions and see one combined statement, **so that** my earnings are clear even with several business centres.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Trust in pay for multi-position plans. |
| Preconditions | Run committed. |
| Main flow | Open Earnings → choose period → read totals per person → expand each position. |
| Alternative flows | Single position: no grouping level shown. |
| Acceptance criteria | AC-04.1, AC-04.2 |
| Requirements | FR-GEN-001, FR-DIST-001 |
| Dependencies | FR-GEN-001 |

### US-05 — Team leader

**As a** team leader, **I want** to search my downline and see only the fields the company allows, **so that** I can help my team without seeing private data.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Coaching without a privacy breach. |
| Preconditions | Visibility policy configured. |
| Main flow | Open Team → search by name or id → open a member → see permitted fields → expand lazily. |
| Alternative flows | Beyond the depth limit: counts and volume aggregates only, with an explanation. |
| Acceptance criteria | AC-05.1, AC-05.2 |
| Requirements | FR-GEN-006, FR-GEN-007, FR-GEN-008, FR-DIST-004 |
| Dependencies | FR-GEN-008 |

### US-06 — Commission analyst

**As a** commission analyst, **I want** to run a period, review variance against the last run and send it for approval, **so that** mistakes are caught before money moves.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Controlled period close. |
| Preconditions | Cut-off reached; sync healthy. |
| Main flow | Open Periods and runs → start calculation → watch progress → open review → inspect variance, movers and exceptions → fix inputs and re-run if needed → request commit. |
| Alternative flows | Sync behind: calculation blocked with last sync time. Run fails: resume from snapshot. |
| Acceptance criteria | AC-06.1, AC-06.2, AC-06.3 |
| Requirements | FR-COMP-001, FR-COMP-002, FR-COMP-005 |
| Dependencies | FR-INT-002 |

### US-07 — Finance approver

**As a** finance approver, **I want** to approve a committed run only if I did not prepare it, **so that** no single person can release payouts.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Separation of duties. |
| Preconditions | Run Calculated and reviewed. |
| Main flow | Open approvals → read review summary → pass step-up → commit. |
| Alternative flows | Approver is preparer: refused; eligible approvers listed. |
| Acceptance criteria | AC-07.1, AC-07.2 |
| Requirements | FR-IAM-004, FR-COMP-006 |
| Dependencies | FR-IAM-002 |

### US-08 — Commission analyst

**As a** commission analyst, **I want** late orders after commit to land in a queue and post as adjustments, **so that** committed periods stay reproducible.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Nothing lost, nothing silently changed. |
| Preconditions | Period committed. |
| Main flow | Open late-transaction queue → review items and estimated effects → accept default handling → adjustments appear in the open run. |
| Alternative flows | Material item: raise a restatement request instead. |
| Acceptance criteria | AC-08.1 |
| Requirements | FR-ORD-005, FR-COMP-010 |
| Dependencies | FR-COMP-010 |

### US-09 — Compliance officer

**As a** compliance officer, **I want** to request a restatement with a reason and see the diff before approval, **so that** real errors can be corrected openly.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Open correction path. |
| Preconditions | Committed period; evidence of error. |
| Main flow | Open Cases → create restatement → system recalculates in a sandbox → review diff per payee and bonus → send for approval → adjustments post in the open period. |
| Alternative flows | Diff empty: case closed with no action. |
| Acceptance criteria | AC-09.1 |
| Requirements | FR-COMP-009 |
| Dependencies | FR-COMP-008 |

### US-10 — Plan administrator

**As a** plan administrator, **I want** to compare a new plan version with the current one on last period's data, payee by payee, **so that** I know who gains and loses before release.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Predictable change. |
| Preconditions | Draft version; a committed period. |
| Main flow | Open the draft → choose Simulate → pick period → read totals, distribution and payee-level differences → export. |
| Alternative flows | No full historical period available: activation remains blocked. |
| Acceptance criteria | AC-10.1, AC-10.2, AC-10.3 |
| Requirements | FR-PLN-005, FR-PLN-006 |
| Dependencies | FR-COMP-002 |

### US-11 — Plan administrator

**As a** plan administrator, **I want** to configure a cap with scope, base, method and see who is cut, **so that** the cap behaves as the plan document says.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Caps applied to the right lines. |
| Preconditions | Draft version. |
| Main flow | Open caps → set scope, base, rate, method, priority, residue rule → preview on a period → save. |
| Alternative flows | Overlapping caps: precedence must be stated. |
| Acceptance criteria | AC-11.1, AC-11.2 |
| Requirements | FR-PLN-004 |
| Dependencies | FR-PLN-005 |

### US-12 — Distributor

**As a** distributor, **I want** to open any statement line and see how it was calculated, **so that** I can trust or dispute it with facts.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Fewer support contacts; trust. |
| Preconditions | Statement exists. |
| Main flow | Open statement → tap a line → read rule, base, rate, rank, period, rounding → optionally open a dispute. |
| Alternative flows | Extension rule without template: generic explanation listing inputs. |
| Acceptance criteria | AC-12.1 |
| Requirements | FR-IAM-007, FR-DIST-002 |
| Dependencies | FR-COMP-007 |

### US-13 — Support agent

**As a** support agent, **I want** to see the full calculation trace for a payout line, **so that** I can answer pay questions without engineering.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Lower handling time. |
| Preconditions | Agent has trace permission. |
| Main flow | Search the payee → open statement → open line trace → read source orders, plan version, rule and intermediate values. |
| Alternative flows | Snapshot in cold storage: trace requested and delivered asynchronously. |
| Acceptance criteria | AC-13.1 |
| Requirements | FR-COMP-007 |
| Dependencies | FR-COMP-008 |

### US-14 — Finance manager

**As a** finance manager, **I want** the sum of payout lines, residues and withholding to equal the run total to the minor unit, **so that** the ledger reconciles.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Zero unexplained difference. |
| Preconditions | Committed run. |
| Main flow | Open ledger for the period → compare control totals → open residue account. |
| Alternative flows | Projection mismatch: rebuilt automatically and alerted. |
| Acceptance criteria | AC-14.1, AC-14.2, AC-14.3 |
| Requirements | FR-COMP-003, FR-COMP-012, FR-FIN-001, FR-FIN-002 |
| Dependencies | FR-FIN-001 |

### US-15 — Finance manager

**As a** finance manager, **I want** a journal export mapped to our chart of accounts at period end, **so that** our ERP stays the general ledger.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | No duplicate accounting system. |
| Preconditions | Mapping configured. |
| Main flow | Open Ledger and exports → choose period → generate → download or fetch by API. |
| Alternative flows | Unmapped account: export blocked with the list. |
| Acceptance criteria | AC-15.1 |
| Requirements | FR-FIN-005 |
| Dependencies | FR-FIN-001 |

### US-16 — Payout officer

**As a** payout officer, **I want** failed and returned payments to come back to a queue and be re-instructed safely, **so that** nobody is paid twice or not at all.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Payout integrity. |
| Preconditions | Batch instructed. |
| Main flow | Open reconciliation → see settled, returned, failed, unmatched → open a returned item → fix cause through a case → include in next batch. |
| Alternative flows | Provider rejects whole batch: retry failed lines only. |
| Acceptance criteria | AC-16.1, AC-16.2, AC-16.3 |
| Requirements | FR-PAY-002, FR-PAY-003, FR-PAY-004 |
| Dependencies | FR-PAY-003 |

### US-17 — Distributor

**As a** distributor, **I want** to be told when my bank details change, and payouts to wait before using new details, **so that** a takeover cannot redirect my money.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Payout fraud control. |
| Preconditions | Signed in. |
| Main flow | Open Payment details → submit new details → re-authenticate → see cooling-off date → receive notices on old and new contacts. |
| Alternative flows | Payout due inside cooling-off: held, shown on statement. |
| Acceptance criteria | AC-17.1, AC-17.2 |
| Requirements | FR-PAY-005, FR-DIST-006, FR-DIST-008 |
| Dependencies | FR-IAM-007 |

### US-18 — Finance manager (withholding market)

**As a** finance manager (withholding market), **I want** withholding applied to payees who meet the market rule and year-end statements produced, **so that** we meet our withholding duty.

| Field | Content |
|---|---|
| Release | MVP-B (market pack) |
| Business value | Mandatory duty of the payer. Example pack: Malaysia (rate and threshold to be confirmed by a tax adviser). |
| Preconditions | Market pack tax rules confirmed. |
| Main flow | Review tax rules → run period → see withholding lines → at year end generate forms → export. |
| Alternative flows | Missing tax ids: listed; forms held for those payees. |
| Acceptance criteria | AC-18.1, AC-18.2 |
| Requirements | FR-TAX-002, FR-TAX-003 |
| Dependencies | FR-TAX-001 |

### US-19 — Finance manager (missing-tax-id rule market)

**As a** finance manager (missing-tax-id rule market), **I want** the higher rate applied when no tax id is held, **so that** we meet the rule in force.

| Field | Content |
|---|---|
| Release | MVP-B (market pack) |
| Business value | Mandatory duty. Example pack: India (provision and rates to be confirmed by a chartered accountant). |
| Preconditions | Market pack rule with missing-id rate. |
| Main flow | Run period → payees without tax id carry the higher rate → statement shows it. |
| Alternative flows | Tax id supplied later: applies from the next pay date; no retroactive change without the market's rule. |
| Acceptance criteria | AC-19.1 |
| Requirements | FR-TAX-002 |
| Dependencies | FR-TAX-001 |

### US-20 — Finance manager

**As a** finance manager, **I want** to choose a clawback policy per bonus type and see receivables and write-offs, **so that** refunds are recovered consistently.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Consistent, explainable recovery. |
| Preconditions | Plan bonuses defined. |
| Main flow | Open settings → choose policy per bonus → view receivables ageing → propose write-offs → get approval. |
| Alternative flows | Payee has no future earnings: receivable ages until written off. |
| Acceptance criteria | AC-20.1, AC-20.2, AC-20.3 |
| Requirements | FR-FIN-003, FR-FIN-004 |
| Dependencies | FR-FIN-001 |

### US-21 — Compliance officer

**As a** compliance officer, **I want** to define participant types and order purposes, **so that** the retail-customer share is measured on the right population.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Correct compliance population. |
| Preconditions | Tenant settings access. |
| Main flow | Define types with flags → define purpose requirement → approve. |
| Alternative flows | Type change for a participant: effective-dated; past orders keep labels. |
| Acceptance criteria | AC-21.1, AC-21.2 |
| Requirements | FR-PAR-001, FR-ORD-003 |
| Dependencies | FR-TEN-003 |

### US-22 — Operations manager

**As a** operations manager, **I want** orders, refunds and customers from our Shopify or WooCommerce store to flow in automatically and idempotently, **so that** we do not re-key orders.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Data in without manual work. |
| Preconditions | Connector installed. |
| Main flow | Install connector → authorise store → map products to volume → watch sync health. |
| Alternative flows | Unknown product: order held in the exception queue. |
| Acceptance criteria | AC-22.1, AC-22.2, AC-22.3 |
| Requirements | FR-IAM-006, FR-ORD-001, FR-ORD-002, FR-INT-001 |
| Dependencies | FR-IAM-006 |

### US-23 — Support agent

**As a** support agent, **I want** to reassign a terminated distributor's customers by the company's rule, **so that** customers keep being served and attribution stays correct.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Continuity and correct attribution. |
| Preconditions | Termination approved. |
| Main flow | Terminate through case → system applies reassignment rule → review list → override single customers through a case if needed. |
| Alternative flows | No eligible target: customers assigned to the company. |
| Acceptance criteria | AC-23.1 |
| Requirements | FR-PAR-005, FR-CRM-001, FR-CRM-002 |
| Dependencies | FR-PAR-005 |

### US-24 — Compliance officer

**As a** compliance officer, **I want** reports on retail-customer share, personal-consumption share and payout sources per period, **so that** I can answer a regulator or counsel from the system.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | The differentiator candidate; the demand test of MVP-A. |
| Preconditions | Facts loaded or period committed. |
| Main flow | Open Compliance reports → choose period range → create snapshot → read figures with method notes → open a figure to its rows → export. |
| Alternative flows | Data-quality warnings: shown beside affected figures. |
| Acceptance criteria | AC-24.1, AC-24.2 |
| Requirements | FR-CPL-001, FR-CPL-002, FR-CPL-003, FR-CPL-004 |
| Dependencies | FR-CPL-006 |

### US-25 — Compliance officer

**As a** compliance officer, **I want** an earnings distribution computed from all participants' payouts, including zero earners, and kept with its method, **so that** our claims are substantiated.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | Honest disclosure basis. |
| Preconditions | Full year of payout lines. |
| Main flow | Create yearly snapshot → read distribution → (V1) draft and publish disclosure. |
| Alternative flows | Partial year: labelled partial and not publishable. |
| Acceptance criteria | AC-25.1, AC-25.2 |
| Requirements | FR-CPL-005, FR-CPL-009 |
| Dependencies | FR-CPL-006 |

### US-26 — Tenant owner

**As a** tenant owner, **I want** the platform to block plan components that pay solely for enrolment in markets that ban them, and tell me why, **so that** we do not configure an unlawful plan by accident.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Reduced legal exposure for tenant and vendor. |
| Preconditions | Market pack guardrails loaded. |
| Main flow | Plan admin saves a rule → guardrail evaluates → blocked with rule id and explanation, or warned with acknowledgement. |
| Alternative flows | Overridable warning: justification and compliance approval recorded. |
| Acceptance criteria | AC-26.1, AC-26.2 |
| Requirements | FR-CPL-007, FR-CPL-008 |
| Dependencies | FR-CPL-012 |

### US-27 — Plan administrator

**As a** plan administrator, **I want** a plan change to move through simulation, compliance review, filing status, notice and an effective date, with a transition report, **so that** the field is treated fairly and filings are not missed.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Governed change. |
| Preconditions | Draft complete. |
| Main flow | Submit → simulation attached → compliance review → record filing status → set notice → approver schedules activation → transition report produced at first run. |
| Alternative flows | Filing required and missing: blocked. |
| Acceptance criteria | AC-27.1, AC-27.2 |
| Requirements | FR-PLN-001, FR-PLN-007, FR-PLN-008 |
| Dependencies | FR-PLN-005 |

### US-28 — Implementation consultant

**As a** implementation consultant, **I want** to import history and run old and new systems in parallel with a per-payee difference report, **so that** go-live happens only when payouts match.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Safe switching. |
| Preconditions | Legacy extracts. |
| Main flow | Map and import history → validate → configure plan → run parallel period → classify differences → obtain sign-off. |
| Alternative flows | Differences outstanding: go-live blocked. |
| Acceptance criteria | AC-28.1, AC-28.2 |
| Requirements | FR-MIG-001, FR-MIG-002 |
| Dependencies | FR-PLN-005 |

### US-29 — Tenant admin

**As a** tenant admin, **I want** to approve or deny a vendor support session and see everything done in it, **so that** the vendor cannot access our data silently.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | Trust in the vendor. |
| Preconditions | Request raised. |
| Main flow | Receive request → read reason and scope → approve for a duration or deny → later read the session report. |
| Alternative flows | No decision before request expiry: auto-denied. |
| Acceptance criteria | AC-29.1, AC-29.2, AC-29.3 |
| Requirements | FR-IAM-005 |
| Dependencies | FR-AUD-001 |

### US-30 — Distributor

**As a** distributor, **I want** to request access to or erasure of my data, **so that** my privacy rights are honoured.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Mandatory processor support. |
| Preconditions | Identity verifiable. |
| Main flow | Submit request in portal or public form → verify identity → receive export or confirmation → see what is retained and why. |
| Alternative flows | Open payable balance or legal hold: erasure deferred with explanation. |
| Acceptance criteria | AC-30.1 |
| Requirements | FR-PRV-001, FR-PRV-002 |
| Dependencies | FR-CAS-001 |

### US-31 — Tenant admin

**As a** tenant admin, **I want** to keep our data in a chosen region, **so that** we meet residency duties.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | Mandatory where the market requires. |
| Preconditions | Region offered. |
| Main flow | Region chosen at provisioning → shown in settings → support access from outside needs explicit approval. |
| Alternative flows | Region change: migration project, not a setting. |
| Acceptance criteria | AC-31.1 |
| Requirements | FR-TEN-001 |
| Dependencies | FR-TEN-001 |

### US-32 — Analyst

**As a** analyst, **I want** a scheduled export of our full data model, **so that** we can analyse in our own tools and leave if we choose.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Adoption and exit right. |
| Preconditions | Destination configured. |
| Main flow | Configure schedule → receive files and manifest → reconcile counts. |
| Alternative flows | Destination unreachable: retried and alerted. |
| Acceptance criteria | AC-32.1 |
| Requirements | FR-INT-003 |
| Dependencies | FR-AUD-002 |

### US-33 — Compliance officer

**As a** compliance officer, **I want** integrity signals with my thresholds, **so that** I can investigate bonus buying.

| Field | Content |
|---|---|
| Release | V1 |
| Business value | Indicators for investigation. |
| Preconditions | Attributes available. |
| Main flow | Set thresholds → read flags after period close → open case. |
| Alternative flows | Missing attribute: signal disabled with note. |
| Acceptance criteria | AC-33.1 |
| Requirements | FR-CPL-010 |
| Dependencies | FR-ORD-001 |

### US-34 — Distributor (multilingual market)

**As a** distributor (multilingual market), **I want** my statement and key pages in my language and readable on a slow phone, **so that** I understand what I am paid.

| Field | Content |
|---|---|
| Release | MVP-B (market pack) |
| Business value | Comprehension and lower support cost. |
| Preconditions | Market languages translated. |
| Main flow | Choose language → open statement on a phone. |
| Alternative flows | Missing key: market default language shown and logged. |
| Acceptance criteria | AC-34.1 |
| Requirements | FR-DIST-007 |
| Dependencies | FR-DIST-001 |

### US-35 — Staff user

**As a** staff user, **I want** to sign in to my company's workspace with a second factor when my role requires it, **so that** only authorised people reach our data.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | Baseline access control. |
| Preconditions | Account invited. |
| Main flow | Open tenant sign-in → enter credential → pass second factor → land on role home. |
| Alternative flows | No factor enrolled for a privileged role: forced enrolment. |
| Acceptance criteria | AC-35.1, AC-35.2 |
| Requirements | FR-IAM-001, FR-IAM-002 |
| Dependencies | None |

### US-36 — Tenant admin

**As a** tenant admin, **I want** to give each colleague only the permissions their job needs, **so that** mistakes and fraud are contained.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | Least privilege. |
| Preconditions | Admin with MFA. |
| Main flow | Open Users and roles → invite user → assign role and market scope → second admin approves privileged grants. |
| Alternative flows | Conflicting duties: refused with explanation. |
| Acceptance criteria | AC-36.1, AC-36.2 |
| Requirements | FR-IAM-003 |
| Dependencies | FR-IAM-002 |

### US-37 — Tenant admin

**As a** tenant admin, **I want** to configure markets, brands, calendars and policies with a history of changes, **so that** every run can be tied to the settings it used.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Reproducibility and audit. |
| Preconditions | Admin role. |
| Main flow | Open Settings → edit → set effective date and reason → approval for money-affecting keys. |
| Alternative flows | Back-dated change into a committed period: refused. |
| Acceptance criteria | AC-37.1 |
| Requirements | FR-TEN-002, FR-TEN-003 |
| Dependencies | FR-IAM-004 |

### US-38 — Compliance officer

**As a** compliance officer, **I want** a market to go live only when licence evidence, provider approval and tax rules are in place, **so that** we do not operate before we are allowed to.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Launch blockers enforced. |
| Preconditions | Market in Draft. |
| Main flow | Open launch checklist → attach evidence → record provider approval → confirm tax rules status → sign off. |
| Alternative flows | Mandatory rule still at screening status: blocked or written risk acceptance. |
| Acceptance criteria | AC-38.1, AC-38.2 |
| Requirements | FR-TEN-004, FR-CPL-012, FR-PAY-006 |
| Dependencies | FR-CPL-012 |

### US-39 — Implementation consultant

**As a** implementation consultant, **I want** to upload a company's export and get a validation report before anything is stored, **so that** reports rest on clean, minimal data.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | Safe, fast start of the demand test. |
| Preconditions | Data terms accepted. |
| Main flow | Open Data imports → upload three files → read validation report → fix and re-upload → load. |
| Alternative flows | Forbidden column detected: batch rejected, nothing stored. |
| Acceptance criteria | AC-39.1, AC-39.2, AC-39.3 |
| Requirements | FR-IMP-001, FR-IMP-003 |
| Dependencies | None |

### US-40 — Compliance officer

**As a** compliance officer, **I want** to decide how our own codes map to customer, personal use and payout source categories, **so that** the reports reflect our real structure.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | The mapping is the judgement behind the numbers. |
| Preconditions | Validated batch. |
| Main flow | Open mapping → review distinct values with counts → set targets → note reasons → approve. |
| Alternative flows | Value left unknown: counted and shown in data-quality figures. |
| Acceptance criteria | AC-40.1 |
| Requirements | FR-IMP-002 |
| Dependencies | FR-IMP-001 |

### US-41 — Compliance officer

**As a** compliance officer, **I want** to open any figure and see the rows behind it, **so that** I can defend it to counsel.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | Evidence, not assertion. |
| Preconditions | Snapshot exists. |
| Main flow | Click a figure → read population definition → page through rows → export within limits. |
| Alternative flows | Export above the cap: refused with a path to a scheduled export. |
| Acceptance criteria | AC-41.1 |
| Requirements | FR-CPL-006 |
| Dependencies | FR-AUD-002 |

### US-42 — Integration developer

**As a** integration developer, **I want** to enrol participants through the API with sponsor and placement, **so that** our website stays the front end.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | API-first enrolment. |
| Preconditions | API key; market Live. |
| Main flow | Post enrolment → receive participant and position ids → handle duplicate-case response. |
| Alternative flows | Placement slot taken: deterministic alternative returned. |
| Acceptance criteria | AC-42.1, AC-42.2 |
| Requirements | FR-PAR-002, FR-PAR-006, FR-GEN-005 |
| Dependencies | FR-IAM-006 |

### US-43 — Compliance officer

**As a** compliance officer, **I want** suspected duplicate accounts to be held and reviewed, **so that** abuse is caught without blocking legitimate multiple positions.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Account integrity. |
| Preconditions | Matching enabled. |
| Main flow | Open duplicate queue → compare records → decide merge, allow with reason or terminate. |
| Alternative flows | Plan allows several positions per person: flagged as informational only. |
| Acceptance criteria | AC-43.1 |
| Requirements | FR-PAR-003 |
| Dependencies | FR-CAS-001 |

### US-44 — Plan administrator

**As a** plan administrator, **I want** to build our plan from standard building blocks and declare anything special explicitly, **so that** changes do not need custom code.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Lower cost of change. |
| Preconditions | Plan document. |
| Main flow | Create plan → add measures, ladders, bonuses → add extension expressions where needed with golden cases → read plain-language rendering. |
| Alternative flows | Mechanism not expressible: logged as an extension request to the vendor. |
| Acceptance criteria | AC-44.1, AC-44.2 |
| Requirements | FR-GEN-009, FR-PLN-002, FR-PLN-003 |
| Dependencies | FR-PLN-006 |

### US-45 — Finance manager

**As a** finance manager, **I want** returns and exchanges to adjust volume line by line, **so that** pay follows what was really sold.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Correct reversals. |
| Preconditions | Orders ingested. |
| Main flow | Commerce posts return → system computes line volume effect → open period adjusted or late transaction created. |
| Alternative flows | Exchange of equal value flagged: no reversal. |
| Acceptance criteria | AC-45.1, AC-45.2 |
| Requirements | FR-ORD-004 |
| Dependencies | FR-ORD-001 |

### US-46 — Commission analyst

**As a** commission analyst, **I want** to see each position's paid-as rank, title, counters and carry for any period, **so that** I can answer rank questions and check transitions.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Rank disputes resolved with facts. |
| Preconditions | Committed runs. |
| Main flow | Open participant → open qualification tab → pick period → compare with previous. |
| Alternative flows | Imported opening state: labelled as migration. |
| Acceptance criteria | AC-46.1, AC-46.2 |
| Requirements | FR-COMP-004 |
| Dependencies | FR-COMP-006 |

### US-47 — Payout officer

**As a** payout officer, **I want** to prepare a payout batch and see who is excluded and why, **so that** approvers decide on a complete picture.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Controlled release. |
| Preconditions | Period committed. |
| Main flow | Create batch → review inclusion and exclusions → send for approval → after approval watch instruction progress. |
| Alternative flows | Balance changed since draft: batch returns to Draft for the affected line. |
| Acceptance criteria | AC-47.1, AC-47.2 |
| Requirements | FR-PAY-001, FR-PAY-007 |
| Dependencies | FR-FIN-002 |

### US-48 — Distributor

**As a** distributor, **I want** to give my tax details once and see what is withheld, **so that** my net pay is understandable.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Fewer pay questions. |
| Preconditions | Signed in. |
| Main flow | Open tax profile → enter residency and tax id → see masked value → see withholding lines on statements. |
| Alternative flows | Invalid format: inline error. |
| Acceptance criteria | AC-48.1 |
| Requirements | FR-TAX-001 |
| Dependencies | FR-IAM-007 |

### US-49 — Commission analyst

**As a** commission analyst, **I want** to propose a manual adjustment with reason and evidence that someone else approves, **so that** corrections are possible but controlled.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Fraud control. |
| Preconditions | Open period. |
| Main flow | Open Cases → new adjustment → pick payee, amount, reason → attach evidence → preview effect → submit → approver decides. |
| Alternative flows | Above threshold: second approver required. |
| Acceptance criteria | AC-49.1, AC-49.2 |
| Requirements | FR-CAS-002 |
| Dependencies | FR-CAS-001 |

### US-50 — Distributor

**As a** distributor, **I want** to dispute a statement line from my phone and get an explained answer, **so that** I am heard without calling support.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Trust; measured response time. |
| Preconditions | Statement line. |
| Main flow | Tap line → choose Dispute → write message → submit → receive outcome with explanation. |
| Alternative flows | Dispute window passed: explanation shown. |
| Acceptance criteria | AC-50.1 |
| Requirements | FR-CAS-003 |
| Dependencies | FR-DIST-002 |

### US-51 — Distributor

**As a** distributor, **I want** to see my rank, what it required and whether I am in a grace period, **so that** I know where I stand without guessing.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Fewer rank disputes; no projections. |
| Preconditions | Qualification state. |
| Main flow | Open Rank → read current and past periods → read requirements with measured values. |
| Alternative flows | Open period: values labelled not final. |
| Acceptance criteria | AC-51.1 |
| Requirements | FR-DIST-003 |
| Dependencies | FR-COMP-004 |

### US-52 — Distributor

**As a** distributor, **I want** to see the customers I serve and who has reordered, **so that** I can look after them.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Customer-centred activity. |
| Preconditions | Servicing rows. |
| Main flow | Open My customers → filter by last order → open customer. |
| Alternative flows | Customer reassigned away: shown in history with date. |
| Acceptance criteria | AC-52.1 |
| Requirements | FR-DIST-005 |
| Dependencies | FR-CRM-001 |

### US-53 — DPO

**As a** dpo, **I want** breach contacts and timelines recorded per tenant and market, **so that** we can notify without delay.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | Mandatory processor duty. |
| Preconditions | Tenant provisioned. |
| Main flow | Open settings → enter contacts and timelines → confirm. |
| Alternative flows | Missing contact: go-live blocked. |
| Acceptance criteria | AC-53.1 |
| Requirements | FR-PRV-004 |
| Dependencies | FR-TEN-001 |

### US-54 — Compliance officer

**As a** compliance officer, **I want** to search an audit log of who did what and who exported what, **so that** I can investigate and evidence controls.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | Investigation and attestation. |
| Preconditions | Audit read permission. |
| Main flow | Open Audit log → filter by actor, object, action, time → open event. |
| Alternative flows | Vendor staff: readable only inside an approved session. |
| Acceptance criteria | AC-54.1, AC-54.2 |
| Requirements | FR-AUD-001, FR-AUD-002 |
| Dependencies | None |

### US-55 — Tenant admin

**As a** tenant admin, **I want** to see whether order sync and providers are healthy, **so that** runs are not started on partial data.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Avoid wrong pay. |
| Preconditions | Connectors installed. |
| Main flow | Open Integrations → read status, lag, errors → open reconciliation differences → re-authorise if needed. |
| Alternative flows | Failing: guidance and alert. |
| Acceptance criteria | AC-55.1 |
| Requirements | FR-INT-002 |
| Dependencies | FR-ORD-002 |

### US-56 — Executive

**As a** executive, **I want** one overview of sales, payouts as a share of sales and retail share by market, with definitions, **so that** I see the business without asking staff.

| Field | Content |
|---|---|
| Release | MVP-B |
| Business value | Owner visibility. |
| Preconditions | Committed data. |
| Main flow | Open overview → choose period and market → open a figure's definition. |
| Alternative flows | Sync behind: partial-data banner. |
| Acceptance criteria | AC-56.1 |
| Requirements | FR-RPT-001, FR-RPT-002 |
| Dependencies | FR-CPL-006 |

### US-57 — Vendor operations engineer

**As a** vendor operations engineer, **I want** a console that shows tenant health without tenant business data, **so that** I can operate the platform without standing access.

| Field | Content |
|---|---|
| Release | MVP-A |
| Business value | Operability with least privilege. |
| Preconditions | Vendor account with MFA. |
| Main flow | Open console → see tenants, region, tier, health → request a support session when data access is needed. |
| Alternative flows | No session: business data endpoints refuse. |
| Acceptance criteria | AC-57.1 |
| Requirements | FR-OPS-001 |
| Dependencies | FR-IAM-005 |

### US-58 — Licensee administrator

**As a** licensee administrator, **I want** to run the product on our own servers under a licence, apply signed updates when we choose, and get support without giving the vendor standing access, **so that** we keep control of our data and still stay correct and current.

| Field | Content |
|---|---|
| Release | V1 |
| Business value | Opens buyers who will not use hosted software; founder decision DEC-17. |
| Preconditions | Self-hosted edition purchased. |
| Main flow | Run preflight → install → load licence → configure → later download a signed update → let the pre-activation checks run → approve with a second person → generate a support bundle when needed. |
| Alternative flows | Licence lapsed: system keeps calculating and paying, shows notices, refuses new engine and market-pack versions until renewed. |
| Acceptance criteria | AC-58.1, AC-58.2, AC-58.3, AC-58.4 |
| Requirements | FR-LIC-001, FR-LIC-002, FR-LIC-003 |
| Dependencies | FR-AUD-001 |
