# 01 — UX DESIGN SPECIFICATION
## UX principles, role-specific experiences and UX quality requirements

| Field | Value |
|---|---|
| Document ID | UX-01 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | UX architect role |
| Depends on | PRD-01 §3; gap audit 13, 14, 27 |
| Companion documents | UX-02 information architecture · UX-03 sitemap · UX-04 user journeys · UX-05 interaction design |
| Status | Draft. **No UX research exists** in the repository: no interview, usability test or survey. Everything here is design reasoning from workflows and evidence about the population, to be tested before build |

## 1. What the evidence allows us to say about users

| Fact | Source | Design consequence |
|---|---|---|
| Commission analysts are highly technical (SQL, Excel, APIs) and work in cycles | Job postings (PR-01) | Dense, keyboard-friendly tables; periods as home; exports; traces |
| Reviews of incumbents cite "not intuitive", learning curve, "cumbersome" reporting | Directory reviews (weak) | Plain-language summaries above tables; saved views; consistent patterns |
| Sales representatives are 72.1% female; 28% aged 55 and over, 23% under 35 | Industry statistics (contract signers) | Readable type, large targets, no jargon, no dexterity-demanding gestures |
| Candidate markets are multilingual | Research 02 | Local language for distributor pages from launch in such markets |
| Most distributors earn little; 41% of former participants felt misled about their chances | G-S16, G-S27 | Facts only; no projections; no gamified pressure |
| Mobile use by distributors is assumed by vendors, not evidenced | P-09 | Mobile-first portal because it is cheap; no native app until evidence |
| Device, proficiency and daily activities of distributors, leaders, finance and compliance staff | **Unverified** | Usability testing with real users before finalising the five highest-risk screens |

## 2. UX principles

| # | Principle | Meaning in this product | Example |
|---|---|---|---|
| 1 | **Trust through traceability** | Every number can be opened to see where it came from | Figure → rows; statement line → "how calculated"; run total → variance → line → trace |
| 2 | **Clarity before density** | One plain sentence states the situation before any table | "March is calculated and waiting for approval. Total 412,300.00, 3.1% above February." |
| 3 | **Role-specific experiences** | Each role lands on its own work, with its own navigation | Analyst: Periods. Approver: Approvals. Compliance: Reports. Distributor: latest statement |
| 4 | **Simplicity for the many, depth for the few** | Distributor pages show one thing at a time; analyst pages allow density and shortcuts | Statement on a phone against run review on a desktop |
| 5 | **Efficiency in cyclical work** | The period close is a guided sequence with visible state and blockers | State timeline with the next action as the only primary button |
| 6 | **Safe by construction** | Dangerous actions are previewed, attributed and approved by someone else; nothing irreversible happens silently | Effect preview before any money change; preparer cannot approve |
| 7 | **Honest by design** | No income projection, potential-earnings figure, recruit leaderboard or pressure mechanic | Rank page shows requirements and measured values, never "earn up to" |
| 8 | **Reduced cognitive load** | Progressive disclosure; defaults that are safe; one primary action per screen | Late-transaction queue offers "accept default handling" with a preview |
| 9 | **Consistency** | Same component, same behaviour, same word everywhere | "Committed" always means frozen; a lock icon always means read-only by state |
| 10 | **Accessibility and language** | WCAG 2.2 AA; local language; low bandwidth | Server-rendered statement readable without scripts |
| 11 | **Explain limits** | When data is hidden or an action is blocked, say why and what to do | "You can see totals for this part of your team, not names. Your company sets this." |
| 12 | **State is always visible** | Loading, partial, stale, locked and error states are designed, not left to chance | "Order sync is 2 h behind. Runs are blocked until it catches up." |

## 3. User experience architecture by role

Each role has a different landing page, navigation and density. Navigation models are in UX-02.

| Role | Landing | Primary jobs | Density | Device | What they must never have to do |
|---|---|---|---|---|---|
| **Company executive** | Executive overview (SC-35); in MVP-A the compliance overview (SC-46) | See sales, payouts as share of sales, retail share by market; open a definition | Low; cards and trends | Desktop, tablet | Read a table to learn if things are fine |
| **Tenant administrator** | Settings home | Users and roles; markets; integrations; vendor access decisions; audit | Medium | Desktop | Guess why a setting cannot change (state says why) |
| **Finance approver and payout officer** | Approvals queue; payout batches | Review and approve run commits and batches; reconcile; exports; tax | Medium-high | Desktop; approve on tablet | Approve without seeing variance and exclusions |
| **Commission analyst** ("sales teams" in the brief have no evidenced need; analysts are the operational role) | Periods and runs (SC-01) | Run, review, trace, late queue, adjustments | High; keyboard | Desktop | Leave the tool to explain a line |
| **Plan administrator** | Plans | Edit version, simulate, submit | High | Desktop | Activate without simulation |
| **Compliance officer** | Compliance overview | Reports with drill-down; guardrails; plan review; genealogy approvals; investigations | Medium | Desktop | Assemble evidence by hand |
| **Support agent** | Global search | Find person, order, statement; open case | Medium; masked data | Desktop | See unmasked data by default |
| **DPO** | Privacy requests | Verify, fulfil, close in time | Low-medium | Desktop | Track deadlines elsewhere |
| **Team leader** | Distributor home, with Team | Search own team within privacy limits | Low | Phone | See data they should not |
| **Distributor** | Distributor home (SC-37) | Latest pay; why; rank status; customers; bank and tax details | Low; one column | Phone | Read a spreadsheet; interpret jargon |
| **Customer** | **No account in this product.** Touchpoints: public privacy request (SC-41) and, in V1, the public disclosure page (SC-40) | — | — | Phone | — |
| **Vendor operations** | Vendor console (SC-39) | Tenant health; support-session requests; provisioning | Medium | Desktop | See tenant business data without a session |
| **Licensee administrator (self-hosted, V1)** | Settings › System (SC-47) | Licence, updates, diagnostics | Medium | Desktop | Apply an update without seeing its checks |

## 4. The five highest-risk screens

Design and test these first with real analysts and distributors (gap audit 14 §3).

| Screen | Risk | Must have | Test task |
|---|---|---|---|
| Run review (SC-02) | A wrong approval pays thousands | Totals against previous run; variance by bonus; top movers; exceptions; what changed; approve by second person | "Find why leadership bonus rose 12% and decide whether to approve" |
| Plan compare and simulate (SC-04, SC-42) | Change cost and legal effect | Plain-language rule diff; payee-level impact distribution; cap effects; guardrail flags | "Who loses more than 10% under version 8?" |
| Distributor statement (SC-18) | Trust; disputes | Gross, withholding, clawbacks, net; each line → how calculated; rank used; period; disclosure link | "What were you paid in March and why this line?" |
| Genealogy explorer (SC-07, SC-20) | Privacy; scale | Search-first; lazy expansion; counts beyond visibility; as-of date for staff | "Show who sponsored X on 15 March" |
| Case: adjustment or dispute (SC-06) | Fraud vector; audit | Reason codes; evidence; thresholds; effect preview; immutable history | "Propose a 50.00 correction and get it approved" |

## 5. UX quality requirements

### 5.1 Usability

| ID | Requirement | Measure |
|---|---|---|
| UXQ-01 | First-time task success on the five highest-risk screens | ≥ 80% of 5 participants per role without help (proposed) |
| UXQ-02 | Distributor reaches net pay and one line's explanation | ≤ 2 taps from home |
| UXQ-03 | Every blocked action states the reason and the next step | 100% of blocks (heuristic review) |
| UXQ-04 | Every table has a one-sentence summary above it on executive and distributor pages | 100% |
| UXQ-05 | No screen has more than one primary action | 100% |
| UXQ-06 | Terminology matches the glossary (UX-05 §9) | 100% of labels |

### 5.2 Accessibility

Target WCAG 2.2 level AA (NFR-ACC-01). Specific commitments: text contrast ≥ 4.5:1 and non-text ≥ 3:1; all functions by keyboard with visible focus; target size ≥ 24 × 24 CSS px everywhere and ≥ 44 × 44 on distributor pages; no information by colour alone; reflow at 320 px without horizontal scroll (tables excepted with a documented alternative); status messages announced; consistent help; no authentication step that depends on a cognitive test; redundant entry avoided; motion reducible.

### 5.3 Special attention areas

| Area | Requirement |
|---|---|
| **Complex genealogy trees** | Never render a whole tree. Search-first; focused node with breadcrumb to root and first-level children; lazy expansion; counts on collapsed branches; depth cap per request. Accessible as a tree view (arrow-key navigation, level and position announced) with an equivalent indented-list view. Staff get as-of and known-at selectors; a banner states which is shown. A stale read model shows a notice and never more data |
| **Compensation statements** | Order: net first, then how it was reached (gross − withholding − clawbacks ± adjustments). Group by position then bonus. Each line opens an explanation in plain language with rule, base, rate, rank used, period and rounding. Clawbacks and withholding are separate labelled lines. Committed data only: no estimates for open periods. Printable and downloadable. Local language and locale formats |
| **Finance dashboards** | Every figure reconciles to a source and links to it. Show the accounting identity (expense = payable + withholding + residue) as a visible check. Ageing for in-transit and receivables. Exceptions first. Numbers right-aligned, tabular figures, currency stated once per table |
| **Mobile distributor workflows** | One column; bottom navigation with at most five items; thumb-reachable primary actions; forms of at most one question group per screen; numeric keyboards for numeric fields; resilient to connection loss (see below); page weight budget NFR-PERF-06 |
| **Connection loss** | Read pages already loaded stay readable with a "last updated" time. Forms keep entered values locally and submit when the user retries. Money actions are never queued silently: the user sees success or a clear failure |
| **Long jobs** | Runs, imports, simulations and exports show progress with stages, are safe to leave, and notify on completion |

## 6. What is intentionally absent

Recruit leaderboards, income calculators, social feeds, streak-pressure notifications, countdown timers to qualification, built-in training video, native storefront, AI chat for distributors (gap audit 14 §6; BR-HON-01).

## 7. Validation plan

| Step | Method | Participants |
|---|---|---|
| 1 | Walkthrough of wireframes for SC-01, 02, 06, 10 | 3–5 commission, finance or compliance staff from design-partner candidates |
| 2 | Statement comprehension test (SC-18) in the launch language | 5–8 distributors across earning levels and ages |
| 3 | Tree explorer task test (SC-07, SC-20) | 3 support or analyst staff; 3 leaders |
| 4 | Accessibility audit of the prototype | Automated plus manual with assistive technology |

None of these has been done. Until they are, persona-driven choices are hypotheses (open question OQ-21).
