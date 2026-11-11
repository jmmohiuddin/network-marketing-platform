"""Coverage analysis for the public compensation-plan corpus (Phase A, task GAP-020).

Input: plans.csv (one row per plan; y_codes = mechanisms coded Y from the plan text;
new_mechanisms = mechanisms not expressible with the original or extended primitive lists).
Tier rules (stated assumptions, see P1_PLAN_CORPUS.md section 2):
  O = expressible with the original ten building blocks (13 section 3 of the original research)
  M = needs the extended list (M1-M19 in 09 of the gap audit, plus audit rules in 24)
  N = needs a primitive found only in this corpus
Run: python3 -I analyze_corpus.py
"""
import csv
from collections import Counter

O_CODES = set("A1 A2 A3 A4 B1 B2 C1 C2 C6 D1 D2 D3 D4 D5 D6 D10 E1 E3".split())
M_CODES = set("B3 C3 C4 C5 D7 D8 D9 D11 E2 E4 F1 F2 F3 F4 F5".split())
NEW_NAMES = {
    "N-ITEM": "Item-level and derived volume rules (exclusions, tax-exclusive base, category crediting, netting of already-commissioned volume)",
    "N-GATE": "Eligibility from non-volume facts (business/tax registration, certification test, social-media followers, paid subscription)",
    "N-BANK": "Requirement banking or substitution points (protection bank, Flex Points)",
    "N-PROV": "Provisional payments with later true-up (advances, estimated pool payouts)",
    "N-QUOTA": "First-N qualifier quotas",
    "N-HOUSE": "Household / one-business-per-family rule",
    "N-CREDIT": "Credit-risk gating of bonuses and offset of trade receivables",
    "N-BREAK": "Breakage: unpaid amounts retained by the company",
    "N-ROT": "Rotation-based assignment of unassigned customers or orders",
    "N-SELL": "Inventory sell-through gate before reorders (needs reported retail sales)",
    "N-XFER": "Volume transfers between participants (capped, with fee)",
    "N-RULEGEN": "Genealogy change triggered by a rule (loss of sponsorship rights if not qualified in time)",
}

rows = list(csv.DictReader(open("plans.csv", encoding="utf-8")))
for r in rows:
    r["codes"] = set(r["y_codes"].split())
    r["new"] = set(r["new_mechanisms"].split()) if r["new_mechanisms"] else set()
    unknown = r["codes"] - O_CODES - M_CODES
    assert not unknown, (r["id"], unknown)
    r["tier"] = "N" if r["new"] else ("M" if r["codes"] & M_CODES else "O")

hold = [r for r in rows if r["set"] == "HOLD"]
print(f"Plans: {len(rows)} total; {len(hold)} hold-out; {len(rows) - len(hold)} used to derive M1-M19 (DEF)")
print("\nHold-out plans by tier needed:")
tc = Counter(r["tier"] for r in hold)
for t, label in (("O", "original 10 blocks suffice"), ("M", "need extended list M1-M19 / audit rules"), ("N", "need a primitive new in this corpus")):
    print(f"  {t}: {tc[t]:2d}  ({label})")
print(f"  Coverage by original blocks alone: {tc['O']}/{len(hold)}")
print(f"  Coverage by original + extended list: {tc['O'] + tc['M']}/{len(hold)}")
for r in hold:
    print(f"   {r['id']} {r['company']:<28} tier {r['tier']}  {' '.join(sorted(r['new']))}")

print("\nNew mechanism classes (hold-out only):")
nc = Counter(n for r in hold for n in r["new"])
for k, v in sorted(nc.items(), key=lambda x: (-x[1], x[0])):
    print(f"  {k:<10} {v}  {NEW_NAMES[k]}")

print("\nMechanism frequency (all plans / hold-out):")
allc = Counter(c for r in rows for c in r["codes"])
hc = Counter(c for r in hold for c in r["codes"])
for c in sorted(O_CODES | M_CODES):
    tier = "O" if c in O_CODES else "M"
    print(f"  {c} [{tier}] {allc[c]:2d}/{len(rows)}  {hc[c]:2d}/{len(hold)}")
