"""Run: python3 -I packages/engine/test/fixtures/generate.py packages/engine/test/fixtures
Generates packages/engine/test/fixtures/*.json from the verify_calculations.py scenarios.
Values are hypothetical fixtures (DEC-14). Expected amounts are re-derived here with the oracle's own Decimal
arithmetic and asserted against the oracle's printed values before writing."""
import json, sys
from datetime import datetime, timezone
from decimal import Decimal as D, ROUND_HALF_UP, ROUND_DOWN

OUT = sys.argv[1]
CENT = D("0.01")
def r2(x): return D(x).quantize(CENT, rounding=ROUND_HALF_UP)
def m(x): return str(int((D(x) * 100).to_integral_value()))  # decimal currency -> minor string
def us(y, mo, d): return str(int(datetime(y, mo, d, tzinfo=timezone.utc).timestamp()) * 1_000_000)
def largest_remainder(total, weights, keys=None):
    keys = keys or list(range(len(weights))); ws = sum(weights)
    raw = [total * w / ws for w in weights]
    fl = [x.quantize(CENT, rounding=ROUND_DOWN) for x in raw]
    left = int(((total - sum(fl)) / CENT).to_integral_value())
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - fl[i]), keys[i]))
    for i in order[:left]: fl[i] += CENT
    return fl

START, END, KNOWN = us(2027, 3, 1), us(2027, 4, 1), us(2027, 4, 1)
DAY = 86_400_000_000
PROVENANCE = "product-documentation/08-qa/verification/verify_calculations.py (55/55); hypothetical values, not recommendations (DEC-14)"

DIST = {"code": "distributor", "canEarn": True, "countsAsEndCustomer": False, "canSponsor": True, "canHoldPositions": True}
CUST = {"code": "customer", "canEarn": False, "countsAsEndCustomer": True, "canSponsor": False, "canHoldPositions": False}
NO_ITEMS = {"excludeItemClasses": [], "categories": None}

def plan(pid, measures, ladders=(), bonuses=(), caps=()):
    return {"planVersionId": pid, "version": 1, "contentHash": "fixture", "effectiveFromUs": START, "calendars": ["monthly"],
            "measures": list(measures), "ladders": list(ladders), "bonuses": list(bonuses), "constraints": [], "caps": list(caps),
            "carries": [], "counters": [], "transitions": [], "pointsToCurrency": [], "customerRollUp": None}

def personal(key, source, orders="all"):
    return {"kind": "volume.personal", "key": key, "unit": "currency", "source": source, "items": NO_ITEMS, "orders": orders}

def rank(key, *reqs): return {"key": key, "requires": list(reqs), "maintenance": None}
def req(measure, at_least): return {"kind": "measure", "measure": measure, "atLeastMinor": at_least, "window": {"type": "period"}, "maxPerLegShare": None}
def bonus(key, kind, source_kind, policy, eligible=None, **params):
    return {"key": key, "kind": kind, "sourceKind": source_kind, "reversalPolicy": policy, "eligibleIf": eligible, **params}

def snapshot(sid, participants, positions, edges, orders, events=(), withholding=(), receivables=()):
    return {"snapshotId": sid, "market": {"marketId": "MKT", "currency": "XXX", "minorDigits": 2},
            "period": {"periodId": "2027-03", "calendar": "monthly", "startsAtUs": START, "endsAtUs": END}, "knownAtUs": KNOWN,
            "participantTypes": [DIST, CUST], "participants": participants, "positions": positions, "relationships": edges,
            "orders": orders, "orderEvents": list(events), "history": [], "priorState": None, "adjustments": [],
            "receivables": list(receivables), "withholding": list(withholding)}

def participant(pid, type_code="distributor", enrolled=None):
    return {"participantId": pid, "typeCode": type_code, "enrolledAtUs": enrolled or us(2026, 1, 1), "facts": []}
def position(pos, owner): return {"positionId": pos, "ownerParticipantId": owner, "status": "active", "statusFromUs": us(2026, 1, 1)}
def edge(parent, child): return {"kind": "sponsor", "parentPositionId": parent, "childPositionId": child, "leg": None,
                                 "validFromUs": us(2026, 1, 1), "validToUs": None, "recordedAtUs": us(2026, 1, 1), "supersededAtUs": None}
def order(oid, buyer, buyer_type, purpose, credit, amount_minor, volumes=()):
    return {"orderId": oid, "buyerParticipantId": buyer, "buyerTypeCode": buyer_type, "purpose": purpose, "creditPositionId": credit,
            "creditedAtUs": str(int(START) + DAY), "lines": [{"lineId": "1", "productId": "SKU", "itemClass": "product", "category": "general",
            "quantity": 1, "amountMinor": amount_minor, "taxMinor": "0", "volumes": [{"name": n, "perUnitMinor": v} for n, v in volumes]}]}
def wh(pid, rate): return {"participantId": pid, "ruleId": f"fixture-wh-{rate}", "rate": rate, "rounding": "half_up"}
def line(pos, rule, amount): return {"payeePositionId": pos, "ruleKey": rule, "amountMinor": m(amount)}

def write(name, doc):
    with open(f"{OUT}/{name}", "w") as f: json.dump(doc, f, indent=1); f.write("\n")

def chain_case(name, compression, chain, rates, expected, active_measure):
    ids = ["P0"] + [f"L{i}" for i in range(1, len(chain) + 1)]
    measures = [personal("cv", {"from": "volume", "name": "cv"})]
    ladders, eligible = [], None
    if active_measure:
        measures.append(personal("qv", {"from": "volume", "name": "qv"}))
        ladders = [{"key": "main", "ranks": [rank("R1", req("qv", "1"))]}]
        eligible = {"ladder": "main", "rank": "R1"}
    p = plan(f"plan-{name}", measures, ladders,
             [bonus("unilevel", "pay.percent_by_level", "downline_volume", "order_line", eligible, tree="sponsor", measure="cv", levels=rates, compression=compression)])
    orders = [order("o-P0", "pP0", "distributor", "personal", "P0", "0", [("qv", "100"), ("cv", "0")])]
    for i, (active, cv) in enumerate(chain, start=1):
        orders.append(order(f"o-L{i}", f"pL{i}", "distributor", "personal", f"L{i}", m(cv), [("qv", "100" if active else "0"), ("cv", m(cv))]))
    snap = snapshot(f"snap-{name}", [participant(f"p{x}") for x in ids], [position(x, f"p{x}") for x in ids],
                    [edge(ids[i], ids[i + 1]) for i in range(len(ids) - 1)], orders, withholding=[wh(f"p{x}", "0") for x in ids])
    return {"name": name, "input": {"plan": p, "settings": SETTINGS, "snapshot": snap},
            "expected": {"lines": [line(pos, "unilevel", amt) for pos, amt in expected]}}

def unilevel_chain(chain, rates, compress):
    """Per payee in a chain, oracle semantics (TS-02): inactive never earns and its volume is never paid;
    without compression it consumes a level, with compression it does not."""
    out = []
    nodes = [(True, 0)] + chain  # P0 first
    for p in range(len(nodes)):
        if not nodes[p][0]: continue
        total, lvl = D(0), 0
        for active, cv in nodes[p + 1:]:
            if compress and not active: continue
            lvl += 1
            if active and lvl <= len(rates): total += D(rates[lvl - 1]) * D(cv)
        if total: out.append(("P0" if p == 0 else f"L{p}", r2(total)))
    return out

SETTINGS = {"settingsVersionId": "settings-fixture", "roundingMode": "half_up", "restockingFeeAffectsVolume": False}
RATES5 = ["0.08", "0.05", "0.04", "0.04", "0.04"]

# ---- TS-01 ----
ts01_chain = [(True, 1000), (True, 2500), (True, 4000), (True, 6000), (True, 8000)]
ts01 = unilevel_chain(ts01_chain, RATES5, False)
assert ts01[0] == ("P0", D("925.00")), ts01
write("ts01-unilevel.json", {"id": "TS-01", "release": "B", "owner": "payout", "provenance": PROVENANCE,
      "description": "Unilevel 8/5/4/4/4 % over a 5-level chain; P0 total 925.00 (80+125+160+240+320). Other payees derived with the same rule.",
      "cases": [chain_case("ts01", "none", ts01_chain, RATES5, ts01, False)]})

# ---- TS-02 ----
ts02_chain = [(True, 1000), (False, 2500), (True, 4000), (True, 6000), (True, 8000), (True, 5000)]
none, dyn = unilevel_chain(ts02_chain, RATES5, False), unilevel_chain(ts02_chain, RATES5, True)
assert none[0] == ("P0", D("800.00")) and dyn[0] == ("P0", D("1040.00")), (none, dyn)
write("ts02-compression.json", {"id": "TS-02", "release": "B", "owner": "payout", "provenance": PROVENANCE,
      "description": "Chain of 6 below P0, L2 inactive (qv 0 so not R1). P0: 800.00 without compression, 1040.00 dynamic. Relationship rows identical in both cases.",
      "cases": [chain_case("ts02-none", "none", ts02_chain, RATES5, none, True), chain_case("ts02-dynamic", "dynamic", ts02_chain, RATES5, dyn, True)]})

# ---- G-E2E-01 ----
own = {"A": D(100), "B": D(200), "C": D(100), "D": D(300)}; custv = {"B": D(400), "D": D(150)}
e2e_plan = plan("plan-e2e", [personal("pv", {"from": "amount"}), personal("retail_base", {"from": "amount"}, "customer"),
                personal("sales", {"from": "amount"}), {"kind": "volume.group", "key": "gv", "of": "pv", "tree": "sponsor", "includeSelf": True}],
    [{"key": "main", "ranks": [rank("R1", req("pv", m(100))), rank("R2", req("gv", m(700)))]}],
    [bonus("retail", "pay.retail_margin", "retail_sale", "order_line", rate="0.25", measure="retail_base"),
     bonus("unilevel", "pay.percent_by_level", "downline_volume", "order_line", tree="sponsor", measure="pv", levels=["0.08", "0.05"], compression="none"),
     bonus("rank_bonus", "pay.percent_of_measure", "downline_volume", "restatement", measure="gv",
           byRank={"ladder": "main", "rates": [{"rank": "R1", "rate": "0.05"}, {"rank": "R2", "rate": "0.10"}]}),
     bonus("match", "pay.matching", "match", "restatement", tree="sponsor", of=["rank_bonus"], rates=["0.20"])],
    [{"key": "cap_leaders", "scope": ["rank_bonus", "match"], "base": {"kind": "measure", "measure": "sales"}, "rate": "0.20",
      "method": {"type": "priority", "reduce": ["match"]}, "residue": "breakage"}])
e2e_orders = [order(f"o-{k}", f"p{k}", "distributor", "personal", k, m(v)) for k, v in own.items()] + \
             [order("o-K1", "K1", "customer", "customer", "B", m(400)), order("o-K2", "K2", "customer", "customer", "D", m(150))]
e2e_snap = snapshot("snap-e2e", [participant(f"p{k}") for k in own] + [participant("K1", "customer"), participant("K2", "customer")],
                    [position(k, f"p{k}") for k in own], [edge("A", "B"), edge("A", "C"), edge("B", "D")], e2e_orders,
                    withholding=[wh(f"p{k}", "0.02") for k in own])
rb = {"A": D("125.00"), "B": D("105.00"), "C": D("5.00"), "D": D("22.50")}
keys = sorted(rb); rb_after = dict(zip(keys, largest_remainder(sum(rb.values()) - D("7.50"), [rb[k] for k in keys], keys)))
assert rb_after == {"A": D("121.36"), "B": D("101.94"), "C": D("4.85"), "D": D("21.85")}
gross = {"A": D("199.86"), "B": D("237.94"), "C": D("4.85"), "D": D("59.35")}
whd = {k: r2(v * D("0.02")) for k, v in gross.items()}
e2e_lines = [line("A", "rank_bonus", rb_after["A"]), line("A", "unilevel", "78.50"), line("B", "rank_bonus", rb_after["B"]),
             line("B", "retail", "100.00"), line("B", "unilevel", "36.00"), line("C", "rank_bonus", rb_after["C"]),
             line("D", "rank_bonus", rb_after["D"]), line("D", "retail", "37.50")]
write("g-e2e-01.json", {"id": "G-E2E-01", "release": "B", "owner": "run", "provenance": PROVENANCE + "; QA-01 §6",
      "description": "Worked end-to-end example: PV/GV, ranks, retail, unilevel, rank bonus, matching, priority cap (matching first, then rank bonus by largest remainder), withholding 2%. Matching ends at 0.00 so it has no result line.",
      "cases": [{"name": "g-e2e-01", "input": {"plan": e2e_plan, "settings": SETTINGS, "snapshot": e2e_snap}, "expected": {
          "positions": [{"positionId": k, "measures": [{"measure": "pv", "valueMinor": m(pv)}, {"measure": "gv", "valueMinor": m(gv)}], "paidAs": [{"ladder": "main", "rank": r}]}
                        for k, pv, gv, r in [("A", 100, 1250, "R2"), ("B", 600, 1050, "R2"), ("C", 100, 100, "R1"), ("D", 450, 450, "R1")]],
          "lines": e2e_lines,
          "caps": [{"capKey": "cap_leaders", "bound": True, "baseMinor": m(1250), "capMinor": m(250), "proposedMinor": m(284)}],
          "payees": [{"participantId": f"p{k}", "grossMinor": m(gross[k]), "nettedMinor": "0", "withheldMinor": m(whd[k]),
                      "netPayableMinor": m(gross[k] - whd[k]), "receivableAfterMinor": "0"} for k in sorted(gross)],
          "controlTotals": {"grossMinor": m(502), "withheldMinor": m("10.05"), "netPayableMinor": m("491.95"), "nettedMinor": "0", "breakageMinor": m(34)}}}]})

# ---- TS-06 pool ----
holders = [(f"H{i:02d}", 1) for i in range(1, 41)] + [(f"H{i:02d}", 2) for i in range(41, 51)] + [(f"H{i:02d}", 3) for i in range(51, 53)]
pool = D("62500.00"); alloc = largest_remainder(pool, [D(s) for _, s in holders], [h for h, _ in holders])
assert sum(alloc) == pool and sum(r2(pool / 66 * s) for _, s in holders) == D("62500.02")
pool_plan = plan("plan-ts06", [personal("sales", {"from": "amount"}), personal("qv", {"from": "volume", "name": "qv"})],
    [{"key": "main", "ranks": [rank("R1", req("qv", "1")), rank("R2", req("qv", "2")), rank("R3", req("qv", "3"))]}],
    [bonus("pool", "pay.pool", "pool", "restatement", baseMeasure="sales", rate="0.0625",
           allocation={"type": "shares", "ladder": "main", "shares": [{"rank": "R1", "shares": 1}, {"rank": "R2", "shares": 2}, {"rank": "R3", "shares": 3}]})])
pool_orders = [order("o-company", "KC", "customer", "customer", None, m(1000000))] + \
              [order(f"o-{h}", f"p{h}", "distributor", "personal", h, "0", [("qv", str(s))]) for h, s in holders]
pool_snap = snapshot("snap-ts06", [participant("pROOT"), participant("KC", "customer")] + [participant(f"p{h}") for h, _ in holders],
                     [position("ROOT", "pROOT")] + [position(h, f"p{h}") for h, _ in holders], [edge("ROOT", h) for h, _ in holders], pool_orders,
                     withholding=[wh("pROOT", "0")] + [wh(f"p{h}", "0") for h, _ in holders])
write("ts06-pool.json", {"id": "TS-06", "release": "B", "owner": "payout", "provenance": PROVENANCE,
      "description": "Pool 6.25% of market sales 1,000,000.00 = 62,500.00 over 66 shares (40x1, 10x2, 2x3 by paid-as rank). Largest remainder sums to 62,500.00; naive per-share rounding gives 62,500.02.",
      "cases": [{"name": "ts06", "input": {"plan": pool_plan, "settings": SETTINGS, "snapshot": pool_snap},
                 "expected": {"lines": [line(h, "pool", a) for (h, _), a in zip(holders, alloc)], "controlTotals": {"grossMinor": m(pool)}}}]})

# ---- TS-10 refund after payout ----
def ts10_case(name, refunded):
    p = plan("plan-ts10", [personal("pv", {"from": "amount"}), {"kind": "volume.group", "key": "gv", "of": "pv", "tree": "sponsor", "includeSelf": True}],
        [{"key": "main", "ranks": [rank("R1", req("pv", "1")), rank("R2", req("pv", "1"), req("gv", m(700)))]}],
        [bonus("rank_bonus", "pay.percent_of_measure", "downline_volume", "restatement", measure="gv",
               byRank={"ladder": "main", "rates": [{"rank": "R1", "rate": "0.05"}, {"rank": "R2", "rate": "0.10"}]}),
         bonus("match", "pay.matching", "match", "restatement", tree="sponsor", of=["rank_bonus"], rates=["0.20"])])
    events = [{"eventId": "ev-refund-O2", "orderId": "O2", "lineId": "1", "type": "refund", "quantity": 1, "refundMinor": m(500),
               "restockingFeeMinor": "0", "atUs": str(int(START) + 2 * DAY)}] if refunded else []
    s = snapshot(f"snap-{name}", [participant("pA"), participant("pC")], [position("A", "pA"), position("C", "pC")], [edge("C", "A")],
                 [order("O1", "pA", "distributor", "personal", "A", m(300)), order("O2", "pA", "distributor", "personal", "A", m(500))],
                 events, withholding=[wh("pA", "0"), wh("pC", "0")])
    return {"name": name, "input": {"plan": p, "settings": SETTINGS, "snapshot": s}}
paid = {"A": r2(D(800) * D("0.10")), "C": r2(D(800) * D("0.10") * D("0.2"))}
true_ = {"A": r2(D(300) * D("0.05")), "C": r2(D(300) * D("0.05") * D("0.2"))}
assert paid == {"A": D("80.00"), "C": D("16.00")} and (paid["A"] - true_["A"], paid["C"] - true_["C"]) == (D("65.00"), D("13.00"))
write("ts10-refund.json", {"id": "TS-10", "release": "B", "owner": "run", "provenance": PROVENANCE,
      "description": "A's GV 800 includes order O2 (500.00) refunded after payout; C matches 20% of A's rank bonus. 'paid' = original run; 'restated' = same period with the refund. Restatement diff = restated - paid. Order-line clawback (the adjustment origin amount for A) = 10% x 500.00; it is computed outside run() and fed to pass 9.",
      "cases": [{**ts10_case("paid", False), "expected": {"lines": [line("A", "rank_bonus", paid["A"]), line("C", "match", paid["C"])]}},
                {**ts10_case("restated", True), "expected": {"lines": [line("A", "rank_bonus", true_["A"]), line("C", "match", true_["C"])]}}],
      "restatementDiff": [line("A", "rank_bonus", -D("65.00")), line("C", "match", -D("13.00"))],
      "orderLineClawback": {"orderId": "O2", "lines": [line("A", "rank_bonus", -D("50.00"))], "leavesPaid": [line("A", "rank_bonus", "30.00"), line("C", "match", "16.00")]}})

# ---- single-payee settlement scenarios (retail on customer orders) ----
def retail_case(name, positions_amounts, rate, owner_of, withholding, receivables=()):
    p = plan(f"plan-{name}", [personal("retail_base", {"from": "amount"}, "customer")],
             bonuses=[bonus("retail", "pay.retail_margin", "retail_sale", "order_line", rate=rate, measure="retail_base")])
    owners = sorted(set(owner_of.values()))
    s = snapshot(f"snap-{name}", [participant(o) for o in owners] + [participant("K", "customer")],
                 [position(pos, owner_of[pos]) for pos in positions_amounts], [],
                 [order(f"o-{pos}", "K", "customer", "customer", pos, m(a)) for pos, a in positions_amounts.items()],
                 withholding=[wh(o, withholding) for o in owners], receivables=receivables)
    return {"plan": p, "settings": SETTINGS, "snapshot": s}

ts22 = {"X1": D("100.10"), "X2": D("250.25"), "X3": D("49.65")}
assert sum(ts22.values()) == D("400.00")
write("ts22-multi-position.json", {"id": "TS-22", "release": "B", "owner": "run", "provenance": PROVENANCE,
      "description": "One participant owns 3 positions; lines stay per position, the payee settlement rolls them up to 400.00.",
      "cases": [{"name": "ts22", "input": retail_case("ts22", ts22, "1", {k: "P1" for k in ts22}, "0"),
                 "expected": {"lines": [line(k, "retail", v) for k, v in ts22.items()],
                              "payees": [{"participantId": "P1", "grossMinor": m(400), "nettedMinor": "0", "withheldMinor": "0", "netPayableMinor": m(400), "receivableAfterMinor": "0"}]}}]})

g = D("1234.56"); w = r2(g * D("0.02"))
assert (w, g - w) == (D("24.69"), D("1209.87"))
write("ts38-withholding.json", {"id": "TS-38", "release": "B", "owner": "run", "provenance": PROVENANCE,
      "description": "Gross 1,234.56, withholding 2.00% fixture: withheld 24.69, payable 1,209.87, gross = net + withholding.",
      "cases": [{"name": "ts38", "input": retail_case("ts38", {"X": g}, "1", {"X": "P1"}, "0.02"),
                 "expected": {"lines": [line("X", "retail", g)], "payees": [{"participantId": "P1", "grossMinor": m(g), "nettedMinor": "0", "taxableMinor": m(g),
                              "withheldMinor": m(w), "netPayableMinor": m(g - w), "receivableAfterMinor": "0"}]}}]})

write("ts11-netting.json", {"id": "TS-11", "release": "B", "owner": "run", "provenance": PROVENANCE,
      "description": "Clawback receivable 40.00 against earnings 25.00 (retail 25% of 100.00): payable 0.00, receivable 15.00 carried; no debit. Withholding rate 0 keeps the netting/withholding order question out of this case.",
      "cases": [{"name": "ts11", "input": retail_case("ts11", {"X": D(100)}, "0.25", {"X": "P1"}, "0", [{"participantId": "P1", "amountMinor": m(40)}]),
                 "expected": {"lines": [line("X", "retail", 25)], "payees": [{"participantId": "P1", "grossMinor": m(25), "receivableBeforeMinor": m(40),
                              "nettedMinor": m(25), "withheldMinor": "0", "netPayableMinor": "0", "receivableAfterMinor": m(15)}]}}]})

# ---- TS-12 fast start ----
fs_plan = plan("plan-ts12", [personal("sales", {"from": "amount"})], bonuses=[bonus("fast_start", "pay.fast_start", "enrolment_order", "order_line",
    tree="sponsor", measure="sales", buyerEnrolledWithinUs=str(30 * DAY), tiers=[{"rate": "0.20", "perOrderCapMinor": m(200)}, {"rate": "0.10", "perOrderCapMinor": m(80)}])])
fs_snap = snapshot("snap-ts12", [participant("pU"), participant("pS"), participant("pX", enrolled=START)],
                   [position(x, f"p{x}") for x in ("U", "S", "X")], [edge("U", "S"), edge("S", "X")],
                   [order("o-X", "pX", "distributor", "personal", "X", m(1200))], withholding=[wh(f"p{x}", "0") for x in ("U", "S", "X")])
assert (min(D("0.20") * 1200, D(200)), min(D("0.10") * 1200, D(80))) == (D(200), D(80))
write("ts12-fast-start.json", {"id": "TS-12", "release": "B", "owner": "payout", "provenance": PROVENANCE,
      "description": "New enrollee X orders 1,200.00: sponsor S tier 0 20% capped at 200.00 per order (240 -> 200.00); upline U tier 1 10% capped at 80.00 (120 -> 80.00).",
      "cases": [{"name": "ts12", "input": {"plan": fs_plan, "settings": SETTINGS, "snapshot": fs_snap},
                 "expected": {"lines": [line("S", "fast_start", 200), line("U", "fast_start", 80)]}}]})

# ---- primitive-level fixtures ----
lines7 = [D(x) for x in ("1234.57", "987.65", "45.67", "0.37", "12.34", "6789.01", "333.33", "0.99")]
proposed = sum(lines7); cap7 = r2(proposed * D("0.8856")); alloc7 = largest_remainder(cap7, lines7)
assert (proposed, cap7, sum(r2(x * cap7 / proposed) for x in lines7)) == (D("9403.93"), D("8328.12"), D("8328.14"))
f8 = D(100000) / D(115000)
write("caps.json", {"id": "TS-07/TS-08", "release": "B", "owner": "limits+run (caps.ts)", "provenance": PROVENANCE,
      "description": "Company cap allocation on given in-scope lines (minor units, payee ids in canonical order). capMinor = roundRaw(base x rate).",
      "cases": [
        {"name": "ts07-proportional", "lines": [{"payeePositionId": f"P{i+1}", "ruleKey": "bonus", "amountMinor": m(x)} for i, x in enumerate(lines7)],
         "baseMinor": m(proposed), "rate": "0.8856", "method": {"type": "proportional"},
         "expected": {"capMinor": m(cap7), "naiveScaledTotalMinor": m(D("8328.14")), "lines": [{"payeePositionId": f"P{i+1}", "ruleKey": "bonus", "amountMinor": m(a)} for i, a in enumerate(alloc7)]}},
        {"name": "ts08-priority", "lines": [{"payeePositionId": "T", "ruleKey": "team", "amountMinor": m(70000)}, {"payeePositionId": "T", "ruleKey": "leadership", "amountMinor": m(45000)}],
         "baseMinor": m(1000000), "rate": "0.10", "method": {"type": "priority", "reduce": ["leadership"]},
         "expected": {"capMinor": m(100000), "lines": [{"payeePositionId": "T", "ruleKey": "team", "amountMinor": m(70000)}, {"payeePositionId": "T", "ruleKey": "leadership", "amountMinor": m(30000)}]}},
        {"name": "ts08-proportional", "lines": [{"payeePositionId": "T", "ruleKey": "team", "amountMinor": m(70000)}, {"payeePositionId": "T", "ruleKey": "leadership", "amountMinor": m(45000)}],
         "baseMinor": m(1000000), "rate": "0.10", "method": {"type": "proportional"},
         "expected": {"capMinor": m(100000), "lines": [{"payeePositionId": "T", "ruleKey": "team", "amountMinor": m(r2(70000 * f8))}, {"payeePositionId": "T", "ruleKey": "leadership", "amountMinor": m(r2(45000 * f8))}],
                      "movedMinor": m(D("9130.43"))}}]})

g1, g2 = D(500000), D(300000); base9 = g1 * D("1.5") if g2 / (g1 + g2) > D(1) / D(3) else g1 + g2; cap9 = r2(base9 * D("0.4175"))
assert (base9, cap9) == (D(750000), D("313125.00"))
write("ts09-order-structure-cap.json", {"id": "TS-09", "release": "B", "owner": "limits+run (caps.ts)", "provenance": PROVENANCE,
      "description": "CapBase order_structure: second/(first+second) = 37.5% > 1/3 so base = 1.5 x first = 750,000.00 (75% of net sales, < 80%); cap = r2(750,000.00 x 41.75%) = 313,125.00; in-scope 340,000.00 scaled by 0.9210; out-of-scope lines untouched.",
      "cases": [{"name": "ts09", "firstMinor": m(g1), "secondMinor": m(g2), "netSalesMinor": m(1000000), "inScopeMinor": m(340000), "outOfScopeMinor": m(10000),
                 "base": {"kind": "order_structure", "first": "g1", "second": "g2", "secondShareAbove": {"num": 1, "den": 3}, "firstMultiplier": "1.5"}, "rate": "0.4175",
                 "expected": {"baseMinor": m(base9), "capMinor": m(cap9), "baseShareOfNetSalesBelow": "0.8", "factor4dp": "0.9210", "outOfScopeMinor": m(10000)}}]})

write("payout-primitives.json", {"id": "TS-43/TS-44", "release": "B", "owner": "payout", "provenance": PROVENANCE,
      "description": "Single-source primitive values: override rate x measure; differential (own - downline rate) x measure; matching rate x matched bonus.",
      "cases": [{"name": "ts43-override", "kind": "pay.override", "measureMinor": m(6000), "rate": "0.03", "expected": {"amountMinor": m(180)}},
                {"name": "ts43-differential", "kind": "pay.differential", "measureMinor": m(6000), "ownRate": "0.21", "downlineRate": "0.15", "expected": {"amountMinor": m(360)}},
                {"name": "ts44-matching-small", "kind": "pay.matching", "matchedMinor": m(10), "rate": "0.10", "expected": {"amountMinor": m(1)}},
                {"name": "ts44-matching-large", "kind": "pay.matching", "matchedMinor": m(480), "rate": "0.10", "expected": {"amountMinor": m(48)}}]})

write("state-primitives.json", {"id": "TS-04/TS-05", "provenance": PROVENANCE,
      "description": "Unit-agnostic state values. TS-05 carry: min(prev + new, cap) if qualified else 0 (owner qualification, rank.ts). TS-04 binary pairing is Could (OQ-13): no owner, kept for when it ships.",
      "cases": [{"name": "ts05-carry", "release": "B", "owner": "qualification", "capMinor": "3000",
                 "steps": [{"prevMinor": "2800", "newMinor": "900", "qualified": True, "expectedMinor": "3000"}, {"prevMinor": "3000", "newMinor": "100", "qualified": False, "expectedMinor": "0"}]},
                {"name": "ts04-pairing", "release": "Could", "owner": None, "leftMinor": "620", "rightMinor": "900", "leftUnits": 2, "rightUnits": 3, "unitMinor": "100",
                 "expected": {"pairs": 3, "carryLeftMinor": "20", "carryRightMinor": "0"}}]})

tie = largest_remainder(D("100.00"), [D(1)] * 3, ["P1", "P2", "P3"])
write("money.json", {"id": "BR-MNY-03", "release": "B", "owner": "contracts (money.ts)", "provenance": PROVENANCE,
      "cases": [{"name": "tie-break", "totalMinor": m(100), "weights": ["1", "1", "1"], "expectedMinor": [m(x) for x in tie]},
                {"name": "ts06-split", "totalMinor": m(pool), "weights": [str(s) for _, s in holders], "expectedMinor": [m(x) for x in alloc], "naiveTotalMinor": m(D("62500.02"))},
                {"name": "ts07-scale", "totalMinor": m(cap7), "weights": [m(x) for x in lines7], "expectedMinor": [m(x) for x in alloc7]},
                {"name": "e2e-rank-bonus-after-cap", "totalMinor": m(sum(rb_after.values())), "weights": [m(rb[k]) for k in keys], "expectedMinor": [m(rb_after[k]) for k in keys]}],
      "rounding": [{"rawOfMinor": "12500", "rate": "0.05", "expectedMinor": "625"}, {"rawOfMinor": "45000", "rate": "0.08", "expectedMinor": "3600"},
                   {"rawOfMinor": "123456", "rate": "0.02", "expectedMinor": "2469"}, {"rawOfMinor": "-123456", "rate": "0.02", "expectedMinor": "-2469"},
                   {"rawOfMinor": "1", "rate": "0.5", "expectedMinor": "1"}, {"rawOfMinor": "-1", "rate": "0.5", "expectedMinor": "-1"},
                   {"rawOfMinor": "940393", "rate": "0.8856", "expectedMinor": "832812"}]})
print("ok")
