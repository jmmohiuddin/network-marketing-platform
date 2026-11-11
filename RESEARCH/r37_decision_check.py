"""R-37 decision-rule checker (66 Appendix A.6, with the implementation guards in 66 Appendix B section 6).

Reads a coded interview log (CSV, columns as in interview_log_template.csv) and reports, for each pre-agreed
decision rule, SUPPORTED / REFUTED / INCONCLUSIVE using COUNTS (never percentages).

THIS SCRIPT CONTAINS NO DATA AND NO RESULTS. It was tested only on a labelled synthetic fixture kept outside
the deliverables. Real use requires real, coded interviews. Pilot interviews (is_pilot = Y) are excluded.

Usage:  python3 -I r37_decision_check.py interview_log.csv
Values: Y / N / NA (blank = NA). budget_authority: Y / shared / N. would_evaluate: Y / maybe / N.
Company rule: a company's value for a field is Y if any included respondent says Y, else N if any says N, else NA.
"""
import csv
import sys
from collections import defaultdict

OPERATOR_GROUPS = {"exec", "fin", "ops", "cmp"}
TARGET_COMPANIES = 10
TARGET_MID_MARKET = 5


def load(path):
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return [r for r in rows if (r.get("is_pilot") or "").strip().upper() != "Y"]


def by_company(rows, groups):
    d = defaultdict(list)
    for r in rows:
        if r["group"].strip() in groups and r["company_id"].strip():
            d[r["company_id"].strip()].append(r)
    return d


def agg(rs, field):
    vals = [(r.get(field) or "").strip().upper() for r in rs]
    if "Y" in vals:
        return "Y"
    if "N" in vals:
        return "N"
    return "NA"


def agg_ba(rs):
    vals = [(r.get("budget_authority") or "").strip().upper() for r in rs]
    return "Y" if "Y" in vals else ("N" if "N" in vals else "NA")


def verdict(sup, ref, note=""):
    if sup and ref:
        return "CONFLICT (review by hand)" + note
    if sup:
        return "SUPPORTED" + note
    if ref:
        return "REFUTED" + note
    return "INCONCLUSIVE" + note


def half(count, n):
    return n > 0 and 2 * count >= n


def rule_h4(rows):
    comp = by_company(rows, OPERATOR_GROUPS)
    vend = {c: rs for c, rs in comp.items()
            if any((r.get("platform_type") or "").startswith("vendor_") for r in rs)}
    n = len(vend)
    supp = [c for c, rs in vend.items()
            if agg(rs, "change_needed_paid_or_ticket") == "Y" and agg(rs, "change_took_too_long") == "Y"]
    dur = [c for c in supp if agg(vend[c], "change_duration_or_cost_given") == "Y"]
    fast = [c for c, rs in vend.items() if agg(rs, "change_fast_cheap") == "Y"]
    sup = half(len(supp), n) and len(dur) >= 3
    ref = half(len(fast), n)
    return ("H-4 / P-02 cost and speed of change",
            f"vendor-platform companies {n}; paid-or-ticket AND too long {len(supp)}; with duration or cost given {len(dur)}; say fast and cheap {len(fast)}",
            verdict(sup, ref))


def rule_h2(rows):
    comp = by_company(rows, {"fin", "cmp"})
    n = len(comp)
    manual = [c for c, rs in comp.items()
              if agg(rs, "evidence_manual_last12") == "Y" or agg(rs, "reversal_manual") == "Y"]
    eff = [c for c in manual if agg(comp[c], "evidence_effort_given") == "Y"]
    suff = [c for c, rs in comp.items() if agg(rs, "existing_reports_suffice") == "Y"]
    sup = half(len(manual), n) and len(eff) >= 3
    ref = half(len(suff), n)
    return ("H-2, H-8 / P-05, P-12 compliance evidence and reversals",
            f"companies with finance or compliance respondents {n}; manual evidence or reversals {len(manual)}; with effort given {len(eff)}; say existing reports suffice {len(suff)}",
            verdict(sup, ref))


def rule_p13(rows):
    comp = by_company(rows, OPERATOR_GROUPS)
    answered = [c for c, rs in comp.items() if agg(rs, "payee_error_last24") != "NA"]
    err = [c for c in answered
           if agg(comp[c], "payee_error_last24") == "Y" and agg(comp[c], "error_quantified") == "Y"]
    guard = len(answered) < 5
    sup = len(err) >= 3
    ref = len(err) <= 1 and not guard
    note = " (guard: fewer than 5 companies answered; refutation not allowed)" if guard and not sup else ""
    return ("P-13 commission errors are central",
            f"companies that answered {len(answered)}; error affecting several payees with quantified remediation {len(err)}",
            verdict(sup, ref, note) + (" -> the brief's assumption is rejected" if ref and not sup else ""))


def rule_h3(rows):
    comp = by_company(rows, OPERATOR_GROUPS)
    local = {c: rs for c, rs in comp.items()
             if any((r.get("country") or "").strip().upper() in {"MY", "IN"} for r in rs)}
    n = len(local)
    manual = [c for c, rs in local.items() if agg(rs, "local_duties_manual") == "Y"]
    tool = [c for c, rs in local.items() if agg(rs, "names_local_tool_meets_need") == "Y"]
    sup = half(len(manual), n) and len(tool) == 0
    ref = half(len(tool), n)
    return ("H-3 / P-03 local compliance packs",
            f"Malaysian and Indian companies {n}; handle local duties manually {len(manual)}; name a local tool that meets the need {len(tool)}",
            verdict(sup, ref))


def rule_h1(rows):
    comp = by_company(rows, OPERATOR_GROUPS)
    n = len(comp)
    cant = [c for c, rs in comp.items() if agg(rs, "could_not_compare_prices") == "Y"]
    sur = [c for c, rs in comp.items() if agg(rs, "cost_surprise") == "Y"]
    answered = [c for c, rs in comp.items() if agg(rs, "cost_surprise") != "NA"]
    guard = len(answered) < 5
    sup = half(len(cant), n) and len(sur) >= 3
    ref = len(sur) < 3 and not guard
    note = " (guard: fewer than 5 companies answered the cost-surprise question; refutation not allowed)" if guard and not sup else ""
    return ("H-1 price opacity",
            f"operator companies {n}; answered cost-surprise question {len(answered)}; could not compare prices {len(cant)}; cost surprise {len(sur)}",
            verdict(sup, ref, note))


def rule_wtp(rows):
    comp = by_company(rows, OPERATOR_GROUPS)
    n = len(comp)
    pay = [c for c, rs in comp.items()
           if agg_ba(rs) == "Y" and agg(rs, "states_current_spend") == "Y" and agg(rs, "names_budget_for_cluster") == "Y"]
    ev = [c for c, rs in comp.items()
          if any((r.get("would_evaluate") or "").strip().upper() == "Y" for r in rs)]
    asked = [c for c, rs in comp.items()
             if any((r.get("would_evaluate") or "").strip() for r in rs)]
    sup = len(pay) >= 3
    stop = len(asked) >= TARGET_COMPANIES and len(ev) <= 1
    out = verdict(sup, False)
    if stop:
        out = "STOP TRIGGER: one or none of %d companies asked would evaluate or pay" % len(asked)
    elif len(asked) < TARGET_COMPANIES and not sup:
        out = "INCONCLUSIVE (stop trigger not assessable: fewer than %d companies answered the would-evaluate question)" % TARGET_COMPANIES
    return ("Willingness to pay",
            f"operator companies {n}; answered would-evaluate {len(asked)}; budget authority AND current spend AND a named budget {len(pay)}; would evaluate {len(ev)}",
            out)


def sample_report(rows):
    comp = by_company(rows, OPERATOR_GROUPS)
    mid = [c for c, rs in comp.items() if agg(rs, "mid_market") == "Y"]
    countries = defaultdict(set)
    for c, rs in comp.items():
        for r in rs:
            countries[(r.get("country") or "?").strip().upper()].add(c)
    lines = [f"Operator companies: {len(comp)} (target {TARGET_COMPANIES} to 15)",
             f"Mid-market companies: {len(mid)} (target at least {TARGET_MID_MARKET})",
             "Companies by country: " + ", ".join(f"{k} {len(v)}" for k, v in sorted(countries.items()))]
    warn = []
    if len(comp) < TARGET_COMPANIES:
        warn.append("BELOW TARGET SAMPLE: every verdict below is PROVISIONAL")
    if len(mid) < TARGET_MID_MARKET:
        warn.append("Fewer than the target number of mid-market companies: the S1 versus S2 question stays open")
    return lines, warn


def main(path):
    rows = load(path)
    lines, warn = sample_report(rows)
    print("Rows used (pilots excluded):", len(rows))
    print("\n".join(lines))
    for w in warn:
        print("WARNING:", w)
    print()
    for fn in (rule_h4, rule_h2, rule_p13, rule_h3, rule_h1, rule_wtp):
        name, counts, v = fn(rows)
        print(f"{name}\n  counts: {counts}\n  verdict: {v}\n")
    print("Distributor-side problems (P-06 to P-10): no pass or fail; code as counts and quotes and re-rate in 07.")
    print("If a result contradicts a rule, the rule governs, not a later reinterpretation.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 -I r37_decision_check.py interview_log.csv")
    main(sys.argv[1])
