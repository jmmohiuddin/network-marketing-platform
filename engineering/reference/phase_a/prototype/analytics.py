"""Compliance analytics prototype (positioning P4 / MVP-A in the gap audit).

Reads a back-office export (participants.csv, orders.csv, payout_lines.csv) and computes
five reports. Every figure carries its population and method. These are INDICATORS for a
compliance reviewer, not findings that any plan is lawful or unlawful.

  R1 Sales to non-participant customers (share of net sales)
  R2 Personal-use share of the volume that multi-level pay was earned on
  R3 Payout source mix (what the money was paid for)
  R4 Activity that depends on own purchases; end-of-period threshold orders
  R5 Earnings disclosure over ALL distributors, including those who earned nothing

Export schema (columns used):
  participants: participant_id, type, enrolled_month, sponsor_id (servicing distributor for customers)
  orders:       order_id, month, day, buyer_id, amount_cents, volume_cents, purpose
                (customer | personal | resale | unknown | enrolment), is_starter_kit,
                refunded_cents, refund_month
  payout_lines: line_id, month, payee_id, bonus_type, source_kind
                (retail_sale | downline_volume | enrolment_order | pool | match | clawback | other),
                source_order_id, amount_cents
Run: python3 -I analytics.py <export_dir> [report.json]
"""
import csv
import json
import os
import sys
from collections import defaultdict
from statistics import median

DEFAULT_CONFIG = {
    "end_customer_types": ["customer", "preferred_customer"],
    "active_pv_cents": 5000,
    "rank_thresholds_pv_cents": {"active": 5000, "leader": 10000},
    "late_order_day": 27,
    "personal_share_flag": 1 / 3,   # illustrative; the tenant's counsel sets this
}


def load(d):
    def rd(n):
        with open(os.path.join(d, n), encoding="utf-8") as f:
            return list(csv.DictReader(f))
    people = {p["participant_id"]: p for p in rd("participants.csv")}
    orders = rd("orders.csv")
    for o in orders:
        for k in ("amount_cents", "volume_cents", "refunded_cents", "is_starter_kit", "day"):
            o[k] = int(o[k] or 0)
    lines = rd("payout_lines.csv")
    for l in lines:
        l["amount_cents"] = int(l["amount_cents"])
    return people, orders, lines


def pct(n, d):
    return None if d == 0 else round(100.0 * n / d, 2)


def percentile(sorted_vals, q):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * q
    f, c = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def compute(people, orders, lines, cfg=DEFAULT_CONFIG):
    endc = set(cfg["end_customer_types"])
    is_dist = {pid for pid, p in people.items() if p["type"] not in endc}
    months = sorted({o["month"] for o in orders} | {l["month"] for l in lines})
    by_order = {o["order_id"]: o for o in orders}
    rep = {"months": months, "config": {k: v for k, v in cfg.items()}, "R1": {}, "R2": {}, "R3": {}, "R4": {}}

    # ---------- R1 sales to non-participant customers ----------
    for m in months:
        mo = [o for o in orders if o["month"] == m]
        net = lambda o: o["amount_cents"] - o["refunded_cents"]
        total = sum(net(o) for o in mo)
        cust = sum(net(o) for o in mo if people[o["buyer_id"]]["type"] in endc)
        resale = sum(net(o) for o in mo if o["buyer_id"] in is_dist and o["purpose"] == "resale")
        kits = sum(net(o) for o in mo if o["is_starter_kit"])
        part = [o for o in mo if o["buyer_id"] in is_dist and not o["is_starter_kit"]]
        unknown = sum(1 for o in part if o["purpose"] == "unknown")
        rep["R1"][m] = {
            "net_sales_cents": total,
            "customer_share_pct": pct(cust, total),
            "customer_plus_declared_resale_pct": pct(cust + resale, total),
            "starter_kit_share_pct": pct(kits, total),
            "participant_orders_purpose_unknown_pct": pct(unknown, len(part)),
        }

    # ---------- R2 personal-use share of volume that earned multi-level pay ----------
    for m in months:
        ml = [l for l in lines if l["month"] == m and l["source_kind"] == "downline_volume" and l["amount_cents"] > 0]
        oids = {l["source_order_id"] for l in ml}
        vol = sum(by_order[o]["volume_cents"] for o in oids)
        pers = sum(by_order[o]["volume_cents"] for o in oids if by_order[o]["purpose"] == "personal")
        unk = sum(by_order[o]["volume_cents"] for o in oids if by_order[o]["purpose"] == "unknown")
        per_payee_total, per_payee_pers = defaultdict(int), defaultdict(int)
        for l in ml:
            per_payee_total[l["payee_id"]] += l["amount_cents"]
            if by_order[l["source_order_id"]]["purpose"] == "personal":
                per_payee_pers[l["payee_id"]] += l["amount_cents"]
        flagged = sorted(p for p in per_payee_total if per_payee_pers[p] > cfg["personal_share_flag"] * per_payee_total[p])
        rep["R2"][m] = {
            "rewarded_volume_cents": vol,
            "personal_use_share_pct": pct(pers, vol),
            "unknown_purpose_share_pct": pct(unk, vol),
            "payees_with_multilevel_pay": len(per_payee_total),
            "payees_above_flag": len(flagged),
            "flag_threshold": round(cfg["personal_share_flag"], 4),
            "flagged_payees_sample": flagged[:10],
        }

    # ---------- R3 payout source mix ----------
    def mix(sel):
        by = defaultdict(int)
        for l in sel:
            by[l["source_kind"]] += l["amount_cents"]
        gross = sum(v for k, v in by.items() if k != "clawback")
        return {"gross_cents": gross, "clawback_cents": by.get("clawback", 0),
                "share_pct": {k: pct(v, gross) for k, v in sorted(by.items()) if k != "clawback"}}
    for m in months:
        rep["R3"][m] = mix([l for l in lines if l["month"] == m])
    rep["R3"]["year"] = mix(lines)

    # ---------- R4 activity from own purchases; end-of-period threshold orders ----------
    for m in months:
        pv, pv_before_late, cust_orders = defaultdict(int), defaultdict(int), defaultdict(int)
        late = []
        for o in sorted((o for o in orders if o["month"] == m), key=lambda o: o["day"]):
            b = o["buyer_id"]
            if b in is_dist:
                if o["day"] >= cfg["late_order_day"]:
                    late.append((o, pv[b]))
                pv[b] += o["volume_cents"]
            else:
                cust_orders[people[b]["sponsor_id"]] += 1
        active = [d for d in pv if pv[d] >= cfg["active_pv_cents"]]
        no_customer = [d for d in active if cust_orders[d] == 0]
        crossings = []
        for o, before in late:
            after = before + o["volume_cents"]
            for name, t in cfg["rank_thresholds_pv_cents"].items():
                if before < t <= after:
                    crossings.append((o["order_id"], name, o["refunded_cents"] > 0))
        rep["R4"][m] = {
            "active_distributors": len(active),
            "active_with_no_customer_order_pct": pct(len(no_customer), len(active)),
            "late_threshold_crossing_orders": len(crossings),
            "of_which_refunded_later": sum(1 for c in crossings if c[2]),
            "note": "Activity here is defined by the plan on own-purchase volume, so every active status depends on own purchases; the indicator that varies is activity without any customer order.",
        }

    # ---------- R5 earnings disclosure (year) ----------
    year_end = months[-1]
    pop = [pid for pid in is_dist if people[pid]["enrolled_month"] <= year_end]
    earn = defaultdict(int)
    for l in lines:
        earn[l["payee_id"]] += l["amount_cents"]
    vals = sorted(earn.get(p, 0) / 100 for p in pop)
    bands = [("0 or less", lambda v: v <= 0), ("0.01-100", lambda v: 0 < v <= 100),
             ("100.01-1,000", lambda v: 100 < v <= 1000), ("1,000.01-10,000", lambda v: 1000 < v <= 10000),
             (">10,000", lambda v: v > 10000)]
    rep["R5"] = {
        "population": "All distributors holding an agreement at any time in the year, including those who earned nothing",
        "count": len(vals),
        "earned_more_than_zero_pct": pct(sum(1 for v in vals if v > 0), len(vals)),
        "mean": round(sum(vals) / len(vals), 2) if vals else None,
        "median": round(median(vals), 2) if vals else None,
        "p75": round(percentile(vals, 0.75), 2) if vals else None,
        "p90": round(percentile(vals, 0.90), 2) if vals else None,
        "p99": round(percentile(vals, 0.99), 2) if vals else None,
        "max": max(vals) if vals else None,
        "bands": {name: sum(1 for v in vals if f(v)) for name, f in bands},
        "basis": "Gross commissions and bonuses net of clawbacks, before expenses; currency units",
    }
    return rep


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "data_synthetic"
    out = sys.argv[2] if len(sys.argv) > 2 else "report.json"
    rep = compute(*load(d))
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)
    y = rep["R3"]["year"]
    print(f"months {rep['months'][0]}..{rep['months'][-1]}; gross payouts {y['gross_cents'] / 100:,.2f}; clawbacks {y['clawback_cents'] / 100:,.2f}")
    last = rep["months"][-1]
    print("R1", last, rep["R1"][last])
    print("R2", last, {k: v for k, v in rep["R2"][last].items() if k != "flagged_payees_sample"})
    print("R3 year", y["share_pct"])
    print("R4", last, {k: v for k, v in rep["R4"][last].items() if k != "note"})
    print("R5", {k: v for k, v in rep["R5"].items() if k not in ("population", "basis")})


if __name__ == "__main__":
    main()
