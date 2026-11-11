"""Weighted market re-score for Bangladesh and India (P2-75).
Weights: Master Plan section 10 (provisional). Scores 1 (worst) .. 5 (best), with the
basis in P2-75. 'access' is the founder's own access; it is unknown and set to 3 (neutral)
in the base case, then varied from 1 to 5.
Run: python3 -I market_rescore.py"""
W = {"legal": .25, "payout": .15, "companies": .20, "competition": .10,
     "wtp": .15, "access": .10, "data": .05}
S = {
 "India (MLM and direct selling)":            dict(legal=4, payout=3, companies=4, competition=2, wtp=2, access=3, data=3),
 "Bangladesh (MLM operators)":                dict(legal=1, payout=1, companies=1, competition=3, wtp=1, access=3, data=2),
 "Bangladesh (single-level affiliate only)":  dict(legal=2, payout=3, companies=2, competition=3, wtp=2, access=3, data=2),
}
# Cells with low confidence: varied by +/-1 in the sensitivity run
UNCERTAIN = {
 "India (MLM and direct selling)": ["companies", "wtp", "payout", "competition"],
 "Bangladesh (MLM operators)": [],
 "Bangladesh (single-level affiliate only)": ["legal", "payout", "companies", "wtp"],
}
def score(s): return sum(W[k]*v for k, v in s.items())
print("Base case (access unknown = 3); maximum 5.00")
for m, s in S.items(): print(f"  {m:42} {score(s):.2f}")
print("\nFounder access varied 1..5")
for m, s in S.items():
    print(f"  {m:42} " + "  ".join(f"{a}:{score({**s,'access':a}):.2f}" for a in range(1,6)))
print("\nSensitivity: all uncertain cells -1 (low) / +1 (high), access 3")
for m, s in S.items():
    lo = {k: (max(1, v-1) if k in UNCERTAIN[m] else v) for k, v in s.items()}
    hi = {k: (min(5, v+1) if k in UNCERTAIN[m] else v) for k, v in s.items()}
    print(f"  {m:42} low {score(lo):.2f}  base {score(s):.2f}  high {score(hi):.2f}")
print("\nLegal gate: a market scoring 1 on 'legal' is excluded regardless of total.")
