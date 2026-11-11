"""Illustrative unit-economics model for India (P2-76).
EVERY input is an ASSUMPTION (label UE-xx in P2-76). None is evidence. The model shows
which inputs decide viability; it does not say the business is viable.
Run: python3 -I unit_economics.py"""
from itertools import product

FX = 85.0                      # UE-01 INR per USD (assumption for comparisons only)
TEAM = {"lean (UE-02)": 600_000, "standard (UE-03)": 1_500_000}   # INR per month, fully loaded
INFRA_FIXED_PER_TENANT = 8_000 # UE-04 INR/month (cell share, backups, monitoring)
INFRA_PER_PAYEE = 0.30         # UE-05 INR per active payee per month
SUPPORT_HOURS = 10             # UE-06 hours per tenant per month
HOUR_COST = 1_000              # UE-07 INR per staff hour
PAYMENT_FEE_SHARE = 0.03       # UE-08 share of revenue lost to billing/collection

# ---- Model 1: MVP-B engine + compliance, priced per active payee with a monthly minimum
PRICES = [3, 6, 10]                    # UE-09 INR per active payee per month
MINIMUM = 40_000                       # UE-10 INR per tenant per month
SIZES = [2_000, 10_000, 50_000]        # UE-11 active payees per tenant

def contribution_engine(price, payees):
    rev = max(MINIMUM, price * payees)
    cost = INFRA_FIXED_PER_TENANT + INFRA_PER_PAYEE*payees + SUPPORT_HOURS*HOUR_COST + PAYMENT_FEE_SHARE*rev
    return rev, rev - cost

print("MODEL 1 - engine + compliance (per active payee, minimum INR %s/month)" % f"{MINIMUM:,}")
print(f"{'price':>6} {'payees':>7} {'revenue/mo':>11} {'contrib/mo':>11} " + " ".join(f"{'BE '+k.split()[0]:>12}" for k in TEAM))
for price, size in product(PRICES, SIZES):
    rev, c = contribution_engine(price, size)
    be = [f"{(t/c):12.1f}" if c > 0 else f"{'n/a':>12}" for t in TEAM.values()]
    print(f"{price:>6} {size:>7} {rev:>11,.0f} {c:>11,.0f} " + " ".join(be))

# ---- Model 2: MVP-A compliance analytics, flat subscription per tenant
FLAT = [30_000, 60_000, 100_000]       # UE-12 INR per tenant per month
print("\nMODEL 2 - MVP-A compliance analytics (flat monthly fee; infra small)")
for fee in FLAT:
    cost = 3_000 + 4*HOUR_COST + PAYMENT_FEE_SHARE*fee   # UE-13: lighter infra and support
    c = fee - cost
    print(f"  fee {fee:>7,} contrib {c:>8,.0f}  break-even tenants: " + ", ".join(f"{k.split()[0]} {t/c:.1f}" for k, t in TEAM.items()))

# ---- Comparison with local one-time licences (P2-73)
print("\nLOCAL ANCHOR (one-time licence, P2-73): $699 = INR %s; $5,399 = INR %s" % (f"{699*FX:,.0f}", f"{5399*FX:,.0f}"))
for price, size in [(6, 10_000)]:
    rev, _ = contribution_engine(price, size)
    print(f"  Model 1 at INR {price}/payee and {size:,} payees bills INR {rev:,.0f}/month = INR {12*rev:,.0f}/year "
          f"= {12*rev/(5399*FX):.1f}x the Standard one-time licence each year")

# ---- Implementation (one-time)
IMPL_FEE = 500_000   # UE-14 INR per tenant
IMPL_HOURS = 250     # UE-15 hours per plan implementation (OQ-09 unknown)
print(f"\nIMPLEMENTATION: fee INR {IMPL_FEE:,} vs cost INR {IMPL_HOURS*HOUR_COST:,} -> margin INR {IMPL_FEE-IMPL_HOURS*HOUR_COST:,}")
