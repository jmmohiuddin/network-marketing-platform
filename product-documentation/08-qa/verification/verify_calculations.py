"""Verification of every calculated expected result in the QA specification.

ALL NUMBERS ARE HYPOTHETICAL. This is a test oracle, not application code: it re-derives the
expected values quoted in 01_QA_AND_ACCEPTANCE_SPECIFICATION.md and 02_TEST_SCENARIOS.md with
exact decimal arithmetic and fails loudly if any quoted value is wrong.
Seed scenarios TS-01..TS-12 reproduce the research scripts (13_comp_examples.py, 09_comp_stress_tests.py).
Run: python3 -I verify_calculations.py
"""
from decimal import Decimal as D, ROUND_HALF_UP, ROUND_DOWN
from statistics import median

CENT = D("0.01"); checks = []

def r2(x): return D(x).quantize(CENT, rounding=ROUND_HALF_UP)

def largest_remainder(total, weights, keys=None):
    """Split total (2 dp) by weights so parts sum exactly; ties broken by key ascending."""
    keys = keys or list(range(len(weights))); ws = sum(weights)
    raw = [total * w / ws for w in weights]
    fl = [x.quantize(CENT, rounding=ROUND_DOWN) for x in raw]
    left = int(((total - sum(fl)) / CENT).to_integral_value())
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - fl[i]), keys[i]))
    for i in order[:left]: fl[i] += CENT
    return fl

def check(name, got, exp):
    ok = got == exp; checks.append(ok)
    print(("ok   " if ok else "FAIL ") + f"{name}: {got}" + ("" if ok else f"  (expected {exp})"))

# ---- TS-01 unilevel -------------------------------------------------------------------
rates = [D("0.08"), D("0.05"), D("0.04"), D("0.04"), D("0.04")]
vol = [D(1000), D(2500), D(4000), D(6000), D(8000)]
pay = [r2(r * v) for r, v in zip(rates, vol)]
check("TS-01 level payouts", pay, [D("80.00"), D("125.00"), D("160.00"), D("240.00"), D("320.00")])
check("TS-01 total", sum(pay), D("925.00"))

# ---- TS-02 compression ----------------------------------------------------------------
chain = [(True, 1000), (False, 2500), (True, 4000), (True, 6000), (True, 8000), (True, 5000)]
def unilevel(chain, compress):
    total, lvl = D(0), 0
    for active, cv in chain:
        if compress and not active: continue
        lvl += 1
        if not active: continue
        if lvl <= 5: total += rates[lvl - 1] * D(cv)
    return r2(total)
check("TS-02 without compression", unilevel(chain, False), D("800.00"))
check("TS-02 with compression", unilevel(chain, True), D("1040.00"))

# ---- TS-04 binary pairing 2:3 ----------------------------------------------------------
def pairs(left, right, lu, ru, unit=100):
    n = min(left // (lu * unit), right // (ru * unit)); return n, left - n * lu * unit, right - n * ru * unit
check("TS-04 pairs, carry left, carry right", pairs(620, 900, 2, 3), (3, 20, 0))

# ---- TS-05 carry cap and loss when unqualified -----------------------------------------
def carry(prev, new, cap, qualified): return min(prev + new, cap) if qualified else 0
c1 = carry(2800, 900, 3000, True); c2 = carry(c1, 100, 3000, False)
check("TS-05 carry capped then zeroed", (c1, c2), (3000, 0))

# ---- TS-06 pool by shares ---------------------------------------------------------------
pool = D("62500.00"); holders = [1] * 40 + [2] * 10 + [3] * 2
naive = sum(r2(pool / sum(holders) * s) for s in holders)
exact = largest_remainder(pool, [D(s) for s in holders])
check("TS-06 shares", sum(holders), 66)
check("TS-06 naive rounding total", naive, D("62500.02"))
check("TS-06 largest-remainder total", sum(exact), D("62500.00"))

# ---- TS-07 proportional cap over 8 lines -------------------------------------------------
lines = [D(x) for x in ("1234.57", "987.65", "45.67", "0.37", "12.34", "6789.01", "333.33", "0.99")]
proposed = sum(lines); cap = r2(proposed * D("0.8856"))
check("TS-07 proposed", proposed, D("9403.93")); check("TS-07 cap", cap, D("8328.12"))
check("TS-07 naive scaled total", sum(r2(x * cap / proposed) for x in lines), D("8328.14"))
check("TS-07 exact scaled total", sum(largest_remainder(cap, lines)), cap)

# ---- TS-08 priority vs proportional cap --------------------------------------------------
capamt = D(1000000) * D("0.10"); team, ldb = D(70000), D(45000)
check("TS-08 priority: team, leadership", (team, max(D(0), ldb - (team + ldb - capamt))), (D(70000), D(30000)))
f = capamt / (team + ldb)
check("TS-08 proportional: team, leadership", (r2(team * f), r2(ldb * f)), (D("60869.57"), D("39130.43")))

# ---- TS-09 order-structure cap ------------------------------------------------------------
g1, g2, total_net = D(500000), D(300000), D(1000000)
base = g1 * D("1.5") if g2 / (g1 + g2) > D(1) / D(3) else g1 + g2
capped = r2(base * D("0.4175"))
check("TS-09 base, ratio<80%, cap", (base, base / total_net < D("0.8"), capped), (D(750000), True, D("313125.00")))
check("TS-09 factor on in-scope lines", (capped / D(340000)).quantize(D("0.0001")), D("0.9210"))

# ---- TS-10 refund after payout --------------------------------------------------------------
def a_bonus(gv): return gv * (D("0.10") if gv >= 700 else D("0.05"))
a_paid, a_true = a_bonus(D(800)), a_bonus(D(300)); c_paid, c_true = r2(a_paid * D("0.2")), r2(a_true * D("0.2"))
check("TS-10 paid A, C", (r2(a_paid), c_paid), (D("80.00"), D("16.00")))
check("TS-10 order-line clawback A", r2(D(500) * D("0.10")), D("50.00"))
check("TS-10 restatement A, C", (r2(a_paid - a_true), c_paid - c_true), (D("65.00"), D("13.00")))
check("TS-10 left with payees under order-line: A, C", (r2(a_paid - 50), c_paid), (D("30.00"), D("16.00")))

# ---- TS-11 clawback netting and write-off -----------------------------------------------------
recv, earn = D("40.00"), D("25.00"); net = min(recv, earn)
check("TS-11 payable after netting, receivable carried", (earn - net, recv - net), (D("0.00"), D("15.00")))

# ---- TS-12 fast start caps ---------------------------------------------------------------------
check("TS-12 capped amounts", (min(D("0.20") * 1200, D(200)), min(D("0.10") * 1200, D(80))), (D(200), D(80)))

# ---- TS-22 multi-position statement ---------------------------------------------------------------
check("TS-22 person total", sum(D(x) for x in ("100.10", "250.25", "49.65")), D("400.00"))

# ---- TS-38 withholding and balanced entry -------------------------------------------------------
gross = D("1234.56"); wh = r2(gross * D("0.02")); payable = gross - wh
check("TS-38 withholding, payable", (wh, payable), (D("24.69"), D("1209.87")))
check("TS-38 entry balances", gross == payable + wh, True)

# ---- TS-40 payout cycle -----------------------------------------------------------------------------
acct = {"payable": D(0), "transit": D(0), "settled": D(0)}
def post(dr, cr, amt): acct[dr] -= amt; acct[cr] += amt     # credit-normal accounts: credit increases
acct["payable"] += D(98)                                   # commit (credit payable)
for step in ("instruct", "return", "instruct", "settle"):
    if step == "instruct": post("payable", "transit", D(98))
    if step == "return":   post("transit", "payable", D(98))
    if step == "settle":   post("transit", "settled", D(98))
check("TS-40 payable, in transit, settled", (acct["payable"], acct["transit"], acct["settled"]), (D(0), D(0), D(98)))

# ---- TS-43, TS-44 -------------------------------------------------------------------------------------
check("TS-43 override vs differential", (r2(D("0.03") * 6000), r2((D("0.21") - D("0.15")) * 6000)), (D("180.00"), D("360.00")))
check("TS-44 matching", (r2(D("0.10") * 10), r2(D("0.10") * 480)), (D("1.00"), D("48.00")))

# ---- largest remainder tie-break -------------------------------------------------------------------------
check("Tie-break 100.00 over 3 equal shares (lowest key gets the extra cent)",
      largest_remainder(D("100.00"), [D(1)] * 3, ["P1", "P2", "P3"]), [D("33.34"), D("33.33"), D("33.33")])

# ---- TS-31 overlay fixture (compliance reports) -------------------------------------------------------------
orders = {"O1": dict(buyer="C1", amt=10000, purpose="customer", day=3, ref=0),
          "O2": dict(buyer="D2", amt=6000, purpose="personal", day=5, ref=0),
          "O3": dict(buyer="D2", amt=4000, purpose="resale", day=28, ref=4000)}
ptype = {"D1": "distributor", "D2": "distributor", "C1": "customer"}
jan = [("D1", "retail_sale", "O1", 2500), ("D1", "downline_volume", "O2", 360), ("D1", "downline_volume", "O3", 240)]
feb = [("D1", "clawback", "O3", -240)]
netsales = sum(o["amt"] - o["ref"] for o in orders.values())
cust = sum(o["amt"] - o["ref"] for o in orders.values() if ptype[o["buyer"]] == "customer")
resale = sum(o["amt"] - o["ref"] for o in orders.values() if o["purpose"] == "resale" and ptype[o["buyer"]] != "customer")
pc = lambda n, d: (D(n) * 100 / D(d)).quantize(D("0.01"), rounding=ROUND_HALF_UP)
check("TS-31 R1 net sales (minor units)", netsales, 16000)
check("TS-31 R1 customer share %, incl. declared resale %", (pc(cust, netsales), pc(cust + resale, netsales)), (D("62.50"), D("62.50")))
dl = [l for l in jan if l[1] == "downline_volume"]; src = {l[2] for l in dl}
check("TS-31 R2 personal-use share %", pc(sum(orders[o]["amt"] for o in src if orders[o]["purpose"] == "personal"), sum(orders[o]["amt"] for o in src)), D("60.00"))
pay_personal = sum(l[3] for l in dl if orders[l[2]]["purpose"] == "personal"); pay_ml = sum(l[3] for l in dl)
check("TS-31 R2 payee above one-third flag", pay_personal * 3 > pay_ml, True)
g = sum(l[3] for l in jan)
check("TS-31 R3 retail %, downline %", (pc(2500, g), pc(600, g)), (D("80.65"), D("19.35")))
check("TS-31 R3 year clawbacks", sum(l[3] for l in feb), -240)
earn = {"D1": sum(l[3] for l in jan + feb) / 100, "D2": 0}
check("TS-31 R5 population, % above zero, median", (len(earn), pc(sum(1 for v in earn.values() if v > 0), len(earn)), r2(median(earn.values()))), (2, D("50.00"), D("14.30")))
pv_before = 6000; crossed = pv_before < 10000 <= pv_before + 4000
check("TS-31 R4 late order crosses 100.00 threshold and was refunded", (crossed, orders["O3"]["ref"] > 0), (True, True))

# ---- Worked end-to-end example (QA-01 section 6) -----------------------------------------------------------------
sponsor = {"B": "A", "C": "A", "D": "B"}                          # A is the top position
own = {"A": D(100), "B": D(200), "C": D(100), "D": D(300)}        # personal orders
custv = {"B": D(400), "D": D(150)}                                # serviced customers' orders
pv = {k: own[k] + custv.get(k, D(0)) for k in own}
def downline(p): return [c for c, s in sponsor.items() if s == p]
def gv(p): return pv[p] + sum(gv(c) for c in downline(p))
GV = {k: gv(k) for k in own}
check("E2E PV", pv, {"A": D(100), "B": D(600), "C": D(100), "D": D(450)})
check("E2E GV", GV, {"A": D(1250), "B": D(1050), "C": D(100), "D": D(450)})
rank = {k: ("R2" if GV[k] >= 700 else "R1") for k in own}
check("E2E ranks", rank, {"A": "R2", "B": "R2", "C": "R1", "D": "R1"})
retail = {k: r2(v * D("0.25")) for k, v in custv.items()}
check("E2E retail", retail, {"B": D("100.00"), "D": D("37.50")})
uni = {}
for p in own:
    l1 = downline(p); l2 = [g for c in l1 for g in downline(c)]
    amt = sum(pv[c] for c in l1) * D("0.08") + sum(pv[c] for c in l2) * D("0.05")
    if amt: uni[p] = r2(amt)
check("E2E unilevel", uni, {"A": D("78.50"), "B": D("36.00")})
rb = {k: r2(GV[k] * (D("0.10") if rank[k] == "R2" else D("0.05"))) for k in own}
check("E2E rank bonus before cap", rb, {"A": D("125.00"), "B": D("105.00"), "C": D("5.00"), "D": D("22.50")})
match = {p: r2(sum(rb[c] for c in downline(p)) * D("0.20")) for p in own if downline(p)}
check("E2E matching before cap", match, {"A": D("22.00"), "B": D("4.50")})
net_sales = sum(own.values()) + sum(custv.values()); cap = r2(net_sales * D("0.20"))
in_scope = sum(rb.values()) + sum(match.values())
check("E2E net sales, cap, in-scope proposed", (net_sales, cap, in_scope), (D(1250), D("250.00"), D("284.00")))
over = in_scope - cap; cut_match = min(over, sum(match.values())); over -= cut_match
match_after = {k: D("0.00") for k in match}                       # priority 1: matching removed entirely (26.50)
keys = sorted(rb); rb_after = dict(zip(keys, largest_remainder(sum(rb.values()) - over, [rb[k] for k in keys], keys)))
check("E2E matching removed, rank bonus removed", (cut_match, over), (D("26.50"), D("7.50")))
check("E2E rank bonus after cap", rb_after, {"A": D("121.36"), "B": D("101.94"), "C": D("4.85"), "D": D("21.85")})
check("E2E in-scope after cap equals cap", sum(rb_after.values()) + sum(match_after.values()), cap)
gross = {k: retail.get(k, D(0)) + uni.get(k, D(0)) + rb_after[k] + match_after.get(k, D(0)) for k in own}
check("E2E gross per payee", gross, {"A": D("199.86"), "B": D("237.94"), "C": D("4.85"), "D": D("59.35")})
check("E2E run total", sum(gross.values()), D("502.00"))
whd = {k: r2(v * D("0.02")) for k, v in gross.items()}
check("E2E withholding per payee (fixture 2%)", whd, {"A": D("4.00"), "B": D("4.76"), "C": D("0.10"), "D": D("1.19")})
check("E2E ledger: expense = payable + withholding", (sum(gross.values()), sum(gross.values()) - sum(whd.values()), sum(whd.values())), (D("502.00"), D("491.95"), D("10.05")))
check("E2E compliance R1 customer share %", pc(sum(custv.values()), net_sales), D("44.00"))
tot = sum(gross.values())
check("E2E compliance R3 retail %, downline %", (pc(sum(retail.values()), tot), pc(sum(uni.values()) + sum(rb_after.values()), tot)), (D("27.39"), D("72.61")))

print(f"\n{sum(checks)} of {len(checks)} checks passed")
raise SystemExit(0 if all(checks) else 1)
