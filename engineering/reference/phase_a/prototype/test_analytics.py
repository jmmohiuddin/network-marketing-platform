"""Hand-computed fixture tests for analytics.py. Run: python3 -I test_analytics.py"""
import csv, os, tempfile
import importlib.util
spec = importlib.util.spec_from_file_location("an", os.path.join(os.path.dirname(os.path.abspath(__file__)), "analytics.py"))
an = importlib.util.module_from_spec(spec); spec.loader.exec_module(an)

def write(d, name, rows):
    with open(os.path.join(d, name), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

d = tempfile.mkdtemp()
write(d, "participants.csv", [
    {"participant_id": "D1", "type": "distributor", "enrolled_month": "2024-12", "sponsor_id": "", "market": "T", "status": "active"},
    {"participant_id": "D2", "type": "distributor", "enrolled_month": "2025-01", "sponsor_id": "D1", "market": "T", "status": "active"},
    {"participant_id": "C1", "type": "customer", "enrolled_month": "2025-01", "sponsor_id": "D1", "market": "T", "status": "active"},
])
O = lambda i, day, b, amt, purpose, ref=0, rm="": {"order_id": i, "month": "2025-01", "day": day, "buyer_id": b, "amount_cents": amt,
    "volume_cents": amt, "purpose": purpose, "is_starter_kit": 0, "refunded_cents": ref, "refund_month": rm}
write(d, "orders.csv", [O("O1", 3, "C1", 10000, "customer"), O("O2", 5, "D2", 6000, "personal"), O("O3", 28, "D2", 4000, "resale", 4000, "2025-02")])
L = lambda i, m, p, b, s, o, a: {"line_id": i, "month": m, "payee_id": p, "bonus_type": b, "source_kind": s, "source_order_id": o, "amount_cents": a}
write(d, "payout_lines.csv", [L("L1", "2025-01", "D1", "retail_commission", "retail_sale", "O1", 2500),
    L("L2", "2025-01", "D1", "unilevel", "downline_volume", "O2", 360), L("L3", "2025-01", "D1", "unilevel", "downline_volume", "O3", 240),
    L("L4", "2025-02", "D1", "clawback", "clawback", "O3", -240)])

r = an.compute(*an.load(d))
jan = "2025-01"
checks = [
    ("R1 net sales", r["R1"][jan]["net_sales_cents"], 16000),
    ("R1 customer share", r["R1"][jan]["customer_share_pct"], 62.5),
    ("R1 customer + declared resale (resale refunded)", r["R1"][jan]["customer_plus_declared_resale_pct"], 62.5),
    ("R2 personal-use share of rewarded volume", r["R2"][jan]["personal_use_share_pct"], 60.0),
    ("R2 payees above 1/3 flag", r["R2"][jan]["payees_above_flag"], 1),
    ("R3 Jan retail share", r["R3"][jan]["share_pct"]["retail_sale"], 80.65),
    ("R3 Jan downline share", r["R3"][jan]["share_pct"]["downline_volume"], 19.35),
    ("R3 year clawbacks", r["R3"]["year"]["clawback_cents"], -240),
    ("R4 active distributors", r["R4"][jan]["active_distributors"], 1),
    ("R4 active with no customer order", r["R4"][jan]["active_with_no_customer_order_pct"], 100.0),
    ("R4 late threshold crossings", r["R4"][jan]["late_threshold_crossing_orders"], 1),
    ("R4 of which refunded", r["R4"][jan]["of_which_refunded_later"], 1),
    ("R5 population includes zero earner", r["R5"]["count"], 2),
    ("R5 earned > 0", r["R5"]["earned_more_than_zero_pct"], 50.0),
    ("R5 median (0 and 28.60)", r["R5"]["median"], 14.3),
    ("R5 band zero", r["R5"]["bands"]["0 or less"], 1),
]
bad = [(n, got, exp) for n, got, exp in checks if got != exp]
for n, got, exp in checks:
    print(("ok  " if got == exp else "FAIL"), n, got, "(expected", str(exp) + ")")
# invariants on the synthetic export
s = an.compute(*an.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data_synthetic")))
for m in s["months"]:
    sh = s["R3"][m]["share_pct"]
    if sh:
        assert abs(sum(sh.values()) - 100) < 0.05, (m, sh)
    for k in ("customer_share_pct", "customer_plus_declared_resale_pct"):
        v = s["R1"][m][k]
        assert v is None or 0 <= v <= 100, (m, k, v)
    assert s["R1"][m]["customer_share_pct"] is None or s["R1"][m]["customer_share_pct"] <= s["R1"][m]["customer_plus_declared_resale_pct"]
assert sum(s["R5"]["bands"].values()) == s["R5"]["count"]
print("invariants on synthetic export: ok")
print("ALL TESTS PASSED" if not bad else f"{len(bad)} FAILED")
