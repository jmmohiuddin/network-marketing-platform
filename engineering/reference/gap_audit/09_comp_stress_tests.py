"""Stress tests for 09_COMPENSATION_ENGINE_GAP_RESEARCH.md.

ALL NUMBERS ARE HYPOTHETICAL. Structures echo sources named in each test:
  G-S02 Herbalife FTC stipulated order (definitions G, s.I.A.4)
  G-S26 Modere India plan (priority cap on one bonus)
  G-S29 DirectScale clawback article (deduct commission paid on the refunded order)
  13 EX-6 of the original research (profit pool by shares)
Money is handled with Decimal in minor units (cents); nothing here is legal advice.
Run: python3 -I 09_comp_stress_tests.py
"""
from decimal import Decimal as D, ROUND_HALF_UP, ROUND_DOWN

CENT = D("0.01")


def r2(x):
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


def largest_remainder(total, weights):
    """Split `total` (Decimal, cents) in proportion to weights so the parts sum exactly to total."""
    wsum = sum(weights)
    raw = [total * w / wsum for w in weights]
    floors = [x.quantize(CENT, rounding=ROUND_DOWN) for x in raw]
    left = int(((total - sum(floors)) / CENT).to_integral_value())
    order = sorted(range(len(raw)), key=lambda i: (raw[i] - floors[i]), reverse=True)
    for i in order[:left]:
        floors[i] += CENT
    return floors


print("T1 Pool by shares (13 EX-6 structure): rounding each share vs exact allocation")
pool = D("62500.00")
holders = [1] * 40 + [2] * 10 + [3] * 2          # shares per holder: 40 Silver, 10 Gold, 2 Platinum
per_share = pool / sum(holders)
naive = [r2(per_share * s) for s in holders]
exact = largest_remainder(pool, [D(s) for s in holders])
print(f"  pool {pool}; shares {sum(holders)}; per share {r2(per_share)}")
print(f"  naive rounding pays {sum(naive)} (difference {sum(naive) - pool})")
print(f"  largest-remainder pays {sum(exact)} (difference {sum(exact) - pool})")

print("\nT2 Company-level cap applied by proportional scaling: rounding residue")
lines = [D(x) for x in ("1234.57", "987.65", "45.67", "0.37", "12.34", "6789.01", "333.33", "0.99")]
proposed = sum(lines)
cap = r2(proposed * D("0.8856"))
scaled_naive = [r2(x * cap / proposed) for x in lines]
scaled_exact = largest_remainder(cap, lines)
print(f"  proposed {proposed}; cap {cap}")
print(f"  naive scaled sum {sum(scaled_naive)} (vs cap {sum(scaled_naive) - cap}); exact sum {sum(scaled_exact)}")

print("\nT3 Priority cap vs proportional cap (Modere India structure: cap on two bonuses, only one reduced)")
sales = D("1000000"); cap_rate = D("0.10")
team_bonus = D("70000"); ldb = D("45000")
capamt = sales * cap_rate
over = team_bonus + ldb - capamt
ldb_priority = max(D(0), ldb - over)
f = capamt / (team_bonus + ldb)
print(f"  cap {capamt}; proposed team {team_bonus} + LDB {ldb} = {team_bonus + ldb}")
print(f"  priority (reduce LDB only): team {team_bonus}, LDB {ldb_priority}")
print(f"  proportional: team {r2(team_bonus * f)}, LDB {r2(ldb * f)}")
print("  -> a leader earning only team bonus is unaffected under priority, cut under proportional")

print("\nT4 Herbalife-order structure (G-S02): adjusted rewardable base and a cap that excludes wholesale commissions")
total_net = D("1000000")
g1 = D("500000")   # component G.1 of Net Rewardable Sales (read the order for its exact definition)
g2 = D("300000")   # component G.2, limited to one-third of G.1 + G.2
share_g2 = g2 / (g1 + g2)
nrs = g1 * D("1.5") if share_g2 > D(1) / D(3) else g1 + g2
print(f"  G.2 share {share_g2:.4f} > 1/3 -> NRS = 1.5 x G.1 = {nrs} (instead of {g1 + g2})")
ratio = nrs / total_net
if ratio < D("0.8"):
    capped = r2(nrs * D("0.4175"))
    mlc_excl_wholesale = D("340000")
    print(f"  NRS/Total {ratio:.2%} < 80% -> MLC excluding wholesale commissions capped at {capped}; proposed {mlc_excl_wholesale}; factor {(capped / mlc_excl_wholesale):.4f}")
    print("  wholesale commissions are outside the cap; a model that scales ALL pay (13 EX-9) cuts the wrong lines")

print("\nT5 Refund after payout: order-line clawback vs full restatement (rank and matching cascade)")
# Period 1: A's group volume = order X (500, from B) + 300 (from D). Rank 2 needs GV >= 700 and pays 10% of GV; rank 1 pays 5%.
# C matches 20% of A's bonus. Order X is refunded in period 2 after period 1 was paid.
def a_bonus(gv):
    return gv * (D("0.10") if gv >= 700 else D("0.05"))
gv_paid, gv_true = D(800), D(300)
a_paid, a_true = a_bonus(gv_paid), a_bonus(gv_true)
c_paid, c_true = r2(a_paid * D("0.20")), r2(a_true * D("0.20"))
line_claw_a = D(500) * D("0.10")       # commission attributable to order X at the rate paid
print(f"  paid in P1: A {a_paid}, C {c_paid};  true P1 after refund: A {a_true}, C {c_true}")
print(f"  order-line clawback (deduct commission paid on X): A -{line_claw_a}, C -0  -> A keeps {a_paid - line_claw_a}, C keeps {c_paid}")
print(f"  full restatement: A -{a_paid - a_true}, C -{c_paid - c_true}  -> A keeps {a_true}, C keeps {c_true}")
print(f"  difference left with payees under order-line clawback: A {a_paid - line_claw_a - a_true}, C {c_paid - c_true}")
