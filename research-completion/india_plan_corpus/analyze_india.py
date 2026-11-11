"""Coverage of the India plan corpus against the Phase A tiers.
Run: python3 -I analyze_india.py  (reads plans_india.csv in this folder)"""
import csv, os
from collections import Counter
here = os.path.dirname(os.path.abspath(__file__))
O = set("A1 A2 A3 A4 B1 B2 C1 C2 C6 D1 D2 D3 D4 D5 D6 D10 E1 E3".split())
M = set("B3 C3 C4 C5 D7 D8 D9 D11 E2 E4 F1 F2 F3 F4 F5".split())
rows = list(csv.DictReader(open(os.path.join(here, "plans_india.csv"))))
def tier(r):
    codes = set(r["y_codes"].split())
    if r["new_mechanisms"].strip(): return "N"
    if codes & M: return "M"
    return "O"
print("Plan tiers")
for r in rows: print(f'  {r["id"]:5} {r["set"]:4} {r["company"]:9} tier={tier(r)}  new={r["new_mechanisms"] or "-"}')
hold = [r for r in rows if r["set"] == "HOLD"]
t = Counter(tier(r) for r in hold)
print(f"Hold-out coverage: O={t['O']} M={t['M']} N={t['N']} of {len(hold)}; extended list covers {t['O']+t['M']} of {len(hold)}")
c = Counter(code for r in rows for code in r["y_codes"].split())
print("Mechanism frequency, all India plans (n=%d):" % len(rows))
for code, n in sorted(c.items(), key=lambda x: (-x[1], x[0])): print(f"  {code}: {n}")
