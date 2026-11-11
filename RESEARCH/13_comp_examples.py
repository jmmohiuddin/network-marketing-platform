"""Worked examples for 13_COMPENSATION_PLAN_RESEARCH.md.
ALL NUMBERS ARE HYPOTHETICAL unless a line says it reproduces a vendor's published example.
Plan parameters echo structures reported in sources (S-141 Young Living review, S-143 Epixel, S-120/S-121 Herbalife)
but the volumes, counts and prices are invented for illustration and are not any company's data.
Run: python3 -I 13_comp_examples.py
"""
from math import floor

print("EX-1 Unilevel, 5 levels (rates 8,5,4,4,4 %; S-141 structure, hypothetical volumes)")
rates=[0.08,0.05,0.04,0.04,0.04]
vol=[1000,2500,4000,6000,8000]
pay=[round(r*v,2) for r,v in zip(rates,vol)]
print("  level payouts:",pay,"total:",sum(pay))

print("EX-1b Compression, illustrative definition: inactive members are removed from the level-count path")
# chain from the earner downward: levels of members and activity; each member contributes monthly CV
members=[("m1",True,1000),("m2",False,2500),("m3",True,4000),("m4",True,6000),("m5",True,8000),("m6",True,5000)]
def payout(chain,compress):
    total=0; lvl=0
    for name,active,cv in chain:
        if compress:
            if not active: continue   # skipped; does not consume a level
            lvl+=1
        else:
            lvl+=1
            if not active: continue   # level consumed, volume not paid
        if lvl<=5: total+=rates[lvl-1]*cv
    return round(total,2)
print("  without compression:",payout(members,False)," with compression:",payout(members,True))

print("EX-2 Binary pairing (reproduces vendor examples in S-143)")
def pairs(left,right,lu,ru,unit=100,bonus_per_pair=10):
    n=min(left//(lu*unit),right//(ru*unit))
    return n,n*bonus_per_pair,left-n*lu*unit,right-n*ru*unit
for (l,r,lu,ru) in [(300,350,1,1),(3300,3333,1,1),(300,600,1,2),(620,900,2,3)]:
    n,b,cl,cr=pairs(l,r,lu,ru)
    print(f"  {l} vs {r} ratio {lu}:{ru} -> pairs {n}, bonus ${b}, carry-forward left {cl} right {cr}")
print("  weak-leg 10% version (S-143): left 500, right 1100 -> bonus", 0.10*min(500,1100), "carry strong leg", 1100-500)
print("  cap example (S-143): weekly cap 100 SV, legs 200/300 ->", min(200,100), min(300,100), "counted; flushed", 200-100, 300-100)

print("EX-3 Stairstep breakaway (hypothetical)")
gv=6000
print("  override model: 3% of breakaway group volume =", 0.03*gv)
print("  differential model: sponsor 21% vs member 15% on group volume 6000 =", round((0.21-0.15)*gv,2))

print("EX-4 Matrix 3x5 capacity (S-125 / S-142 describe the grid; numbers computed)")
cap=[3**k for k in range(1,6)]
print("  positions per level:",cap,"total:",sum(cap))
print("  a member who personally enrols 5 people has only 3 frontline slots; 2 are placed under others (spillover)")

print("EX-5 Fast start with caps (parameters from S-141 review: 20% cap $200 per order; upline 10% cap $80; order value hypothetical)")
order=1200
print("  uncapped:",0.20*order,"capped:",min(0.20*order,200),"| upline uncapped:",0.10*order,"capped:",min(0.10*order,80))

print("EX-6 Profit-sharing pool by shares (6.25% of company CV per S-141; counts hypothetical)")
cv=1_000_000; pool=0.0625*cv
holders={"Silver":(40,1),"Gold":(10,2),"Platinum":(2,3)}
shares=sum(n*s for n,s in holders.values())
val=pool/shares
print(f"  pool ${pool:,.0f}; total shares {shares}; value per share ${val:,.2f}")
for k,(n,s) in holders.items(): print(f"  {k}: {n} members x {s} share(s) -> ${s*val:,.2f} each")

print("EX-7 Matching bonus (S-143: 10% of a downline's bonus)")
print("  downline bonus $10 -> match $",0.10*10,"; downline bonus $480 -> match $",0.10*480)

print("EX-8 Refund after commissions were paid (hypothetical): 500 CV order, L1 8%, L2 5%")
a1=0.08*500; a2=0.05*500
print("  commissions generated:",a1,a2)
period2_commissions_L1=25
bal=period2_commissions_L1-a1
print("  if reversal is netted against the L1 earner's next-period commissions of 25 ->",bal,"(negative balance policy needed: carry, write off, or collect)")

print("EX-9 Company-level payout cap (structure per S-120/S-121 summaries; numbers hypothetical)")
total_net=1_000_000; rewardable=700_000
ratio=rewardable/total_net
cap_rate=0.4175
if ratio<0.8:
    cap_amt=cap_rate*rewardable
    proposed=330_000
    print(f"  rewardable share {ratio:.0%} < 80% -> cap {cap_rate:.2%} of rewardable = ${cap_amt:,.0f}; proposed pool ${proposed:,} -> scaling factor {cap_amt/proposed:.4f}")
