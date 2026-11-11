# 07 — PROBLEM SEVERITY MATRIX (RECONSTRUCTED)
## Ratings, opportunity status and the gate G3 test for problems P-01..P-18

| Field | Value |
|---|---|
| Document ID | 07-R (reconstruction of `07_PROBLEM_SEVERITY_MATRIX.md`) |
| Version | 0.1-R |
| Date | 2026-11-12 |
| Status | **Reconstruction, not the original.** The original file (1,849 words, script-generated, SHA-256 `fea92d6b…f49f1` in the gap audit's snapshot) is not in the repository (OQ-22) |
| Rebuilt from | `06_PROBLEM_RESEARCH.md` (Severity, Frequency, Evidence and Existing-software fields of every record), `GAP_AUDIT/01` row 11, `00_RESEARCH_EXECUTION_ROADMAP` §5 (gate G3), `66_OPEN_QUESTIONS_AND_ASSUMPTIONS` §7 |
| Rule used | Nothing here is new evidence. Every rating is copied from 06, which states that it applies "the 07 rubric". Where 06 does not state something the original 07 contained, this document says **not recoverable** |

**If the original file is found, it replaces this one.** Compare its SHA-256 with the snapshot value before using it.

## 1. The rubric (as applied in 06)

06 quotes the rubric's behaviour but not its full text. What can be recovered:

| Rating | Condition as applied in 06 | Examples in 06 |
|---|---|---|
| **High (documented)** | A documented severe consequence: a legal sanction or a personal-data breach, from a counted source class | P-04 (breach notified to 3,527 residents, S-133); P-05 (FTC stipulated judgment with a compensation cap, S-120) |
| **Medium (documented)** | A documented recurring cost, delay, effort or customer harm short of a sanction | P-01, P-02, P-08, P-11, P-12, P-13, P-14, P-15, P-18 |
| **Medium (by rubric)** | Structural problem; no failure or sanction documented | P-03, P-06 |
| **Not rated** | No non-vendor source documents a consequence | P-07, P-09, P-10, P-16, P-17 |
| **"High if it occurs"** | A separate note, not a rating: the consequence would be High, but no occurrence was documented | P-01, P-03, P-11, P-12 |

**Evidence classes** (06 §1.1): R regulator, F filing, J job posting, I incident or trade press, K consumer case, P practitioner, A academic, B buyer reviews (weak), V vendor (**never counted**). The two-class test counts distinct counted classes.

**Not recoverable:** the exact numeric scale (if any), the weighting of frequency against severity, and the script that generated the original.

## 2. Matrix

| ID | Problem | Severity (06) | Frequency (06) | Counted evidence classes | Classes | Two-class test | Existing software | Opportunity status |
|---|---|---|---|---|---|---|---|---|
| P-01 | Legacy and manual commission tooling | Medium; High if the platform fails | Not evidenced | J, F | 2 | Pass | Named legacy tools at two employers; fit unknown | Hypothesis; falsifier stated |
| P-02 | Cost and speed of changing the plan | Medium | Not evidenced | B, J, F | 3 | Pass | Some vendors may already serve it (S-098) | Hypothesis; contested |
| P-03 | Operating in several markets | Medium by rubric; High if it occurs in a licensed market | Structural | F, J, R | 3 | Pass | 0 of 8 vendors state per-market compliance (silence) | Hypothesis; **local vendors in India now read (73)** |
| P-04 | Protecting distributor personal data | **High (documented)** | One incident | I, F, R | 3 | Pass | Vendors claim certifications; unverified | Table stakes rather than differentiator |
| P-05 | Producing compliance evidence on demand | **High (documented)** | Not evidenced for routine requests | R, F, J | 3 | Pass | 0 of 8 vendors state CMP-01..12 | **Strongest opportunity** (basis of MVP-A) |
| P-06 | Distributor attrition and low earnings | Medium (operator) | Net counts only (one company) | F, A | 2 | Pass | Engagement modules; effect unevidenced | Software may not be the lever |
| P-07 | Plan and rank complexity | Not rated | Not evidenced | F, I, P (structure only) | — | n/a | Simulators claimed | No evidence of harm |
| P-08 | Payout timing and visibility | Medium (operator) | Not evidenced | J | 1 | Fail | Providers advertise reach | Distributor side unevidenced |
| P-09 | Distributor mobile experience | Not rated [UV] | Not evidenced | B (weak) | — | n/a | Mobile apps common | Vendor-driven claim |
| P-10 | Team-leader visibility | Not rated [UV] | Not evidenced | F (population only) | — | n/a | Genealogy views common | Vendor-driven claim |
| P-11 | Autoship and dispute friction | Medium; could be High | One case | K, P | 2 | Pass | Consent features not stated | Hypothesis |
| P-12 | Returns, buy-back and reversal | Medium; High if it occurs | Bounded by low return rates | P, R, F | 3 | Pass | Not stated for any vendor | Hypothesis; rule decisions open (D-R2, D-R3) |
| P-13 | Commission accuracy and exception effort | Medium | Not evidenced; reviews contradict | J (B contradicts) | 1 | Fail | Reviewers praise engines | Calculation may not be the pain |
| P-14 | Bonus buying, purchase-driven qualification | Medium (documented) | Not evidenced | J, R, P | 3 | Pass | Not stated | Linked to P-05 (R2, R4 reports) |
| P-15 | Payee tax documentation | Medium at most | Annual | J | 1 | Fail | Tax vendors exist | Market-specific (see 70, 71) |
| P-16 | Cross-border payout and merchant risk | Not rated | Not evidenced | J | 1 | n/a | Orchestrators | See 72 |
| P-17 | Capacity, speed and reporting access | Not rated [UV] | Not evidenced | B (weak) | — | n/a | One negative review | Vendor-driven claim |
| P-18 | Migration and cutover risk | Medium (documented) | Not evidenced | F, J, B | 3 | Pass | Migration services | Parallel-run tooling |

## 3. Counts

| Measure | Count |
|---|---|
| High (documented) | **2** (P-04, P-05) |
| Medium (documented or by rubric) | 11 |
| Not rated | 5 |
| Problems passing the two-class test | 12 |
| Problems that are High **and** pass the two-class test | **2** |

## 4. Gate G3 test

Roadmap §5: "At least five problems rated high severity with evidence from ≥2 independent source types; compensation taxonomy covers at least 90% of observed plan types."

| Criterion | Required | Result | Status |
|---|---|---|---|
| (a) High-severity problems with two counted classes | ≥ 5 | 2 | **Not met** |
| (b) Taxonomy coverage of observed plans | ≥ 90% | 0 of 16 hold-out plans with the original blocks; 5 of 16 (31%) with the extended list (Phase A P1); India corpus adds 0 of 3 fully covered (74) | **Not met** |

**Result: G3 not passed**, which matches 66 §7. The roadmap's fail action is to reposition or narrow to the strongest problem (P-05) and schedule primary research. The product documentation's MVP-A follows that action.

## 5. Changes after Phase 2 desk research (Bangladesh, India)

These are **additions**, not edits to the original ratings.

| ID | Note |
|---|---|
| P-03 | India's Rules impose specific, checkable duties (registration, grievance timelines, sellers' register, in-country data) — 71. This makes the multi-market problem **concrete for India**, but still no documented sanction for a software-caused failure |
| P-05 | India: the duty to publish registers and resolve grievances within one month (71) is evidence-production work; still no documented sanction tied to it |
| P-15 | Bangladesh 10% withholding on commission (s.94, Income Tax Act 2023) and India 2% under s.393 (Income-tax Act 2025) are **recurring, mandatory** — frequency becomes "every payout"; severity unchanged (no penalty case read) |
| P-16 | Bangladesh: no evidence any mainstream provider serves MLM; India: two payment providers prohibit "MLM collection fees" (72). Still not rated |
