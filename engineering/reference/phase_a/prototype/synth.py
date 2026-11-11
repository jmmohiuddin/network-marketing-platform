"""Generate a SYNTHETIC direct-selling export for the compliance-analytics prototype.

Nothing here describes any real company. Volumes, people and behaviour are invented so the
reports have something to compute on. Deterministic: same seed, same files.

Plan used to produce payout lines (invented, simple):
  retail commission 25% of a customer's order to the distributor who services the customer
  unilevel: 6% (level 1) and 4% (level 2) of each order's volume to the credited distributor's
            sponsor chain, only to uplines that are active (personal volume >= 50) that month
  fast start: 15% of a new distributor's enrolment-kit order to the sponsor
  leader pool: 2% of the month's total volume, shared equally by "Leaders"
            (personal volume >= 100 and group volume >= 2,000)
  refunds after the month closes are recovered by order-line clawback in the next month
Amounts are integer cents. Run: python3 -I synth.py [out_dir]
"""
import csv
import os
import random
import sys
from collections import defaultdict

SEED = 20261111
MONTHS = [f"2025-{m:02d}" for m in range(1, 13)]
ACTIVE_PV, LEADER_PV, LEADER_GV = 50_00, 100_00, 2_000_00  # cents of volume
TYPES = {"distributor": False, "customer": True, "preferred_customer": True}


def main(out):
    rnd = random.Random(SEED)
    os.makedirs(out, exist_ok=True)
    people, orders, lines = [], [], []
    sponsor, servicing = {}, {}
    pid = 0

    def new_person(ptype, month, spons):
        nonlocal pid
        pid += 1
        p = {"participant_id": f"P{pid:05d}", "type": ptype, "enrolled_month": month,
             "sponsor_id": spons or "", "market": "DEMO", "status": "active"}
        people.append(p)
        return p["participant_id"]

    # seed distributors
    roots = [new_person("distributor", "2024-12", None) for _ in range(20)]
    dists = list(roots)
    for r in roots:
        sponsor[r] = None
    oid = 0

    def order(month, buyer, amount, purpose, kit=False, day=None):
        nonlocal oid
        oid += 1
        o = {"order_id": f"O{oid:06d}", "month": month, "day": day or rnd.randint(1, 28),
             "buyer_id": buyer, "amount_cents": amount, "volume_cents": amount,
             "purpose": purpose, "is_starter_kit": int(kit), "refunded_cents": 0, "refund_month": ""}
        orders.append(o)
        return o

    for mi, month in enumerate(MONTHS):
        # recruitment
        for _ in range(rnd.randint(25, 45)):
            s = rnd.choice(dists)
            d = new_person("distributor", month, s)
            sponsor[d] = s
            dists.append(d)
            order(month, d, rnd.randint(150_00, 300_00), "enrolment", kit=True)
        # new customers serviced by distributors
        for _ in range(rnd.randint(60, 110)):
            s = rnd.choice(dists)
            c = new_person(rnd.choice(["customer", "customer", "preferred_customer"]), month, s)
            servicing[c] = s
        # customer orders
        for c, s in servicing.items():
            if rnd.random() < 0.35:
                order(month, c, rnd.randint(40_00, 120_00), "customer")
        # distributor personal orders
        for d in dists:
            if rnd.random() < 0.6:
                purpose = rnd.choices(["personal", "resale", "unknown"], [70, 20, 10])[0]
                order(month, d, rnd.randint(50_00, 200_00), purpose)
        # end-of-month threshold buying by a few distributors
        for d in rnd.sample(dists, k=max(1, len(dists) // 30)):
            order(month, d, rnd.randint(60_00, 160_00), "personal", day=rnd.randint(27, 28))

    # refunds: 4% of ordinary orders; 50% of late-month personal orders >= day 27
    for o in orders:
        late = o["purpose"] == "personal" and o["day"] >= 27
        if rnd.random() < (0.5 if late else 0.04):
            mi = MONTHS.index(o["month"])
            if mi + 1 < len(MONTHS):
                o["refunded_cents"] = o["amount_cents"]
                o["refund_month"] = MONTHS[mi + 1]

    # payouts
    line_id = 0
    paid_on_order = defaultdict(list)  # order_id -> [(payee, amount_cents)]

    def pay(month, payee, amount, bonus, source, order_id=""):
        nonlocal line_id
        if amount == 0:
            return
        line_id += 1
        lines.append({"line_id": f"L{line_id:07d}", "month": month, "payee_id": payee,
                      "bonus_type": bonus, "source_kind": source, "source_order_id": order_id,
                      "amount_cents": amount})
        if order_id and source != "clawback":
            paid_on_order[order_id].append((payee, amount))

    by_month = defaultdict(list)
    for o in orders:
        by_month[o["month"]].append(o)
    for month in MONTHS:
        pv = defaultdict(int)
        credited = {}
        for o in by_month[month]:
            b = o["buyer_id"]
            cd = b if b in sponsor else servicing.get(b)
            credited[o["order_id"]] = cd
            if b in sponsor:
                pv[b] += o["volume_cents"]
        gv = defaultdict(int)
        for o in by_month[month]:
            cd = credited[o["order_id"]]
            x = cd
            while x:
                gv[x] += o["volume_cents"]
                x = sponsor.get(x)
        for o in by_month[month]:
            cd = credited[o["order_id"]]
            if o["purpose"] == "customer":
                pay(month, cd, o["amount_cents"] * 25 // 100, "retail_commission", "retail_sale", o["order_id"])
            if o["is_starter_kit"]:
                s = sponsor.get(o["buyer_id"])
                if s:
                    pay(month, s, o["volume_cents"] * 15 // 100, "fast_start", "enrolment_order", o["order_id"])
                continue
            up, rates = sponsor.get(cd), [6, 4]
            for rate in rates:
                if not up:
                    break
                if pv[up] >= ACTIVE_PV:
                    pay(month, up, o["volume_cents"] * rate // 100, "unilevel", "downline_volume", o["order_id"])
                up = sponsor.get(up)
        leaders = sorted(d for d in sponsor if pv[d] >= LEADER_PV and gv[d] >= LEADER_GV)
        if leaders:
            pool = sum(o["volume_cents"] for o in by_month[month]) * 2 // 100
            share, rem = divmod(pool, len(leaders))
            for i, d in enumerate(leaders):
                pay(month, d, share + (1 if i < rem else 0), "leader_pool", "pool")
        # clawbacks for refunds recorded this month on earlier orders
        for o in orders:
            if o["refund_month"] == month:
                for payee, amt in list(paid_on_order.get(o["order_id"], [])):
                    pay(month, payee, -amt, "clawback", "clawback", o["order_id"])

    def write(name, rows):
        with open(os.path.join(out, name), "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    write("participants.csv", people)
    write("orders.csv", orders)
    write("payout_lines.csv", lines)
    with open(os.path.join(out, "README.txt"), "w", encoding="utf-8") as f:
        f.write("SYNTHETIC DATA generated by synth.py (seed %d). Not any company's data.\n" % SEED)
    print(f"{len(people)} participants, {len(orders)} orders, {len(lines)} payout lines -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data_synthetic")
