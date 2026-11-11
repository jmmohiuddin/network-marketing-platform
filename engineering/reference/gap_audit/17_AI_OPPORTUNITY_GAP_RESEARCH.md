# 17 — AI OPPORTUNITY GAP RESEARCH
## Each candidate AI feature, tested against problem, data, accuracy, oversight, privacy, cost and value

| Field | Value |
|---|---|
| Document ID | GAP-17 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 11 |
| Gaps | GAP-070, GAP-071 |
| Evidence of AI demand | **None from buyers.** Vendors market AI without stating capabilities (04 §4; Exigo AI beta, G-S09; Fluid "AI teammate", G-S07). A new vendor offers an MCP server so distributors' AI tools draft only from approved claims (G-S18) |
| Cost figures | Not estimated: model prices change and volumes are unknown. Cost is ranked relatively (Low / Medium / High) |

## 1. Evaluation

**Verdict:** Build · Partner · Later · **Do not build**.

| # | Candidate | User problem | Data needed | Accuracy need | Human oversight | Privacy | Rel. cost | Complexity | Success measure | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| AI-1 | **Run variance explainer** (why did this period differ from last?) | Analysts trace variances by hand (S-130, S-131) | Committed runs, traces, plan diffs | High: must cite lines | Analyst reviews before approval | Tenant data only | Low | Medium | Time to approve a run; variance questions resolved | **Later (V1)** — after deterministic diff reports exist; AI only summarises them |
| AI-2 | **Payout anomaly detection** | Fraud and error before money moves (16 T5, T6) | Run history, adjustments, bank changes | High precision to avoid alert fatigue | Always human | Tenant data | Low | Low (rules) → Medium (ML) | Caught issues per run; false-alert rate | **Build as rules first**; ML later with labelled cases |
| AI-3 | **Statement explanation for distributors** | "Why was I paid this?" (P-07, P-08) | Line traces (GAP-027) | Must not invent; template-bound | Generated from trace; no free answers on income | Own data only | Low-Medium | Medium | Support contacts per payout | **Later (V1)**, template first; AI phrasing only on top of traces |
| AI-4 | **Natural-language reporting for executives** | Owners rely on staff for numbers | Governed metric layer | High | Show query and source | Tenant data | Medium | High | Repeated use; no wrong numbers reported | **Later (V2)**; needs a semantic layer first |
| AI-5 | **Plan-document-to-configuration assistant (internal)** | Implementation cost and paid customisation are the top buyer complaints (03 §6); plans arrive as PDFs (G-S25..G-S28) | Plan documents; primitive set (09) | Draft only; every rule confirmed by golden tests | Implementation analyst approves; simulation required | Plan documents are confidential | Medium | Medium-High | Hours to configure a plan; defects found in parallel run | **Build for internal use (V1)** — GAP-071 |
| AI-6 | **Claims compliance assistant** (check a post against approved claims) | Social-media claims are frequent (G-S15) | Approved-claims library; disclosure figures | High recall, explained flags | Compliance reviews | Distributor posts may contain personal data | Medium | Medium | Flags confirmed by compliance | **Partner** (FieldWatch, Masset-type vendors, G-S17, G-S18); supply approved content and disclosure data |
| AI-7 | Support assistant for staff | Faster answers on orders, statements | Cases, traces, orders | Medium | Agent sends | Masked data | Medium | Medium | Handle time | **Later (V2)** |
| AI-8 | Distributor inactivity or churn prediction | Leaders want to know who needs help | Activity, orders | Low-Medium | Leader decides | Behavioural profiling of contractors | Medium | Medium | Retention of **customers** (not recruits) | **Later, with caution**; rules ("no order in 60 days") are enough first |
| AI-9 | AI sales coach / recruiting scripts / social post generator | "Help me recruit" | Marketing content | — | — | — | Medium | Medium | — | **Do not build**: drives recruitment and earnings claims, the conduct regulators target (S-020, G-S03, G-S15) |
| AI-10 | Income projection or "what you could earn" | Prospect curiosity | Plan rules | — | — | — | Low | Low | — | **Do not build**: misleading by construction for typical participants (G-S16, G-S27) |
| AI-11 | Lead scoring for distributors' prospects | — | Prospect data of uncertain controllership (GAP-041) | — | — | High risk | Medium | Medium | — | **Do not build** |
| AI-12 | Automated training recommendations | Training completion | LMS data | Low | — | Low | Medium | Medium | Completion | **Partner** with LMS vendors (Rallyware, 03 §7) |
| AI-13 | Sales forecasting | Owners plan inventory | Orders | Medium | Analyst | Low | Medium | Medium | Forecast error | **Later (V2)**; the commerce or ERP system may own it |

## 2. Gap records

### GAP-070 — AI use cases evaluated; most should wait or not be built

| Field | Content |
|---|---|
| **Category** | Strategy |
| **Previous research coverage** | Challenge C5; R-18 not started |
| **Missing element** | The evaluation in §1 |
| **Evidence** | §1 sources |
| **Why it matters** | AI features that encourage recruiting or project income create the legal risk the platform is trying to reduce |
| **Affected stakeholders** | Founder, Compliance, distributors |
| **Product implications** | MVP has **no** AI features; V1 adds AI-1, AI-3 and AI-5 on top of deterministic traces |
| **Technical implications** | Any AI output that mentions money must cite trace lines; no model call may write to plans or the ledger |
| **Recommended solution** | Adopt the verdicts in §1 and an AI policy: no income projections, no recruiting content, human approval for anything that changes money |
| **Priority** | Medium |
| **Implementation stage** | V2 for most; V1 for AI-1, AI-3, AI-5 |
| **Confidence** | Medium |
| **Documentation changes required** | Master Plan R-18, R-MOD-M |

### GAP-071 — Plan-document-to-configuration assistant for implementation staff

| Field | Content |
|---|---|
| **Category** | Operational |
| **Previous research coverage** | None |
| **Missing element** | A tool that lowers the cost of turning a plan PDF into tested configuration |
| **Evidence** | Implementation and customisation cost are the most repeated review complaints (03 §6); plans are long, idiosyncratic documents (G-S25..G-S28) |
| **Why it matters** | Cost to serve decides margins (18 GAP-075) |
| **Affected stakeholders** | Implementation staff, tenants |
| **Product implications** | Internal tool first; tenant-facing later if it proves reliable |
| **Technical implications** | Draft configuration + generated golden test cases from plan examples; human sign-off |
| **Recommended solution** | Prototype on the 20–30 plan corpus from GAP-020 |
| **Priority** | Medium |
| **Implementation stage** | V1 (internal) |
| **Confidence** | Low (untested idea) |
| **Documentation changes required** | Future operations and implementation documents |
