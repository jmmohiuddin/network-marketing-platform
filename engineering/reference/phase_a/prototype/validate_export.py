"""Check a design partner's export before computing any report.

Run: python3 -I validate_export.py <export_dir>
Exit code 0 = usable (warnings may remain), 1 = blocking errors. Prints a short list of problems.
Nothing is changed or sent anywhere; the check reads the three CSV files only.
"""
import csv
import os
import re
import sys
from collections import Counter

REQUIRED = {
    "participants.csv": ["participant_id", "type", "enrolled_month", "sponsor_id"],
    "orders.csv": ["order_id", "month", "day", "buyer_id", "amount_cents", "volume_cents", "purpose",
                   "is_starter_kit", "refunded_cents", "refund_month"],
    "payout_lines.csv": ["line_id", "month", "payee_id", "bonus_type", "source_kind", "source_order_id", "amount_cents"],
}
PURPOSES = {"customer", "personal", "resale", "unknown", "enrolment"}
SOURCES = {"retail_sale", "downline_volume", "enrolment_order", "pool", "match", "clawback", "other"}
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
# Columns that must never arrive: direct identifiers and bank data.
FORBIDDEN_TOKENS = {"name", "firstname", "lastname", "fullname", "email", "phone", "mobile", "address", "street",
                    "postcode", "zip", "nric", "ic", "pan", "aadhaar", "ssn", "tin", "passport", "bank", "iban",
                    "account", "dob", "birth", "birthdate"}


def looks_personal(col):
    return any(tok in FORBIDDEN_TOKENS for tok in re.split(r"[^a-z0-9]+", col.lower()) if tok)


def main(d):
    errors, warnings = [], []
    data = {}
    for fn, cols in REQUIRED.items():
        p = os.path.join(d, fn)
        if not os.path.exists(p):
            errors.append(f"{fn}: file missing")
            continue
        with open(p, encoding="utf-8-sig") as f:
            r = csv.DictReader(f)
            header = r.fieldnames or []
            missing = [c for c in cols if c not in header]
            if missing:
                errors.append(f"{fn}: missing columns {missing}")
            bad = [c for c in header if looks_personal(c)]
            if bad:
                errors.append(f"{fn}: columns look like personal or bank data and must be removed before sharing: {bad}")
            data[fn] = list(r)
    if errors:
        return report(errors, warnings)

    people = {p["participant_id"]: p for p in data["participants.csv"]}
    orders = data["orders.csv"]
    lines = data["payout_lines.csv"]
    if len(people) != len(data["participants.csv"]):
        errors.append("participants.csv: duplicate participant_id")
    types = Counter(p["type"] for p in people.values())
    warnings.append(f"participant types found: {dict(types)} — confirm which are non-participant customers")
    for p in people.values():
        if not MONTH.match(p["enrolled_month"]):
            errors.append(f"participant {p['participant_id']}: enrolled_month '{p['enrolled_month']}' is not YYYY-MM")
            break
    orphans = sum(1 for p in people.values() if p["sponsor_id"] and p["sponsor_id"] not in people)
    if orphans:
        warnings.append(f"{orphans} participants have a sponsor_id not in the file (export cut-off or data error)")

    seen = Counter()   # report the first case of each problem, then a count

    def err(cat, msg):
        seen[cat] += 1
        if seen[cat] == 1:
            errors.append(msg)

    def ints(row, keys, where):
        for k in keys:
            try:
                int(row[k] or 0)
            except ValueError:
                err("int", f"{where}: {k}='{row[k]}' is not an integer (amounts must be whole cents)")
                return False
        return True

    id_counts = Counter(o["order_id"] for o in orders)
    order_ids = set(id_counts)
    dups = [k for k, v in id_counts.items() if v > 1]
    if dups:
        errors.append(f"orders.csv: {len(dups)} duplicate order_id values, e.g. {dups[0]}")
    purposes = Counter()
    for o in orders:
        where = f"order {o['order_id']}"
        purposes[o["purpose"]] += 1
        if o["buyer_id"] not in people:
            err("buyer", f"{where}: buyer {o['buyer_id']} not in participants.csv")
        if not MONTH.match(o["month"]) or (o["refund_month"] and not MONTH.match(o["refund_month"])):
            err("month", f"{where}: month or refund_month is not YYYY-MM")
        if not ints(o, ("amount_cents", "volume_cents", "refunded_cents", "day", "is_starter_kit"), where):
            continue
        if int(o["refunded_cents"] or 0) > int(o["amount_cents"]):
            err("overrefund", f"{where}: refunded more than the order amount")
        if int(o["refunded_cents"] or 0) and not o["refund_month"]:
            seen["norefmonth"] += 1
    if seen["norefmonth"]:
        warnings.append(f"{seen['norefmonth']} refunded orders have no refund_month (R4 refund follow-up will miss them)")
    odd = {k: v for k, v in purposes.items() if k not in PURPOSES}
    if odd:
        errors.append(f"orders.csv: purpose values outside {sorted(PURPOSES)}: {odd} — map them before running")
    unknown_share = purposes.get("unknown", 0) / max(1, sum(purposes.values()))
    if unknown_share > 0.25:
        warnings.append(f"{unknown_share:.0%} of orders have purpose 'unknown'; R1 and R2 will be weak indicators")

    kinds = Counter()
    for l in lines:
        kinds[l["source_kind"]] += 1
        where = f"line {l['line_id']}"
        ints(l, ("amount_cents",), where)
        if l["payee_id"] not in people:
            err("payee", f"{where}: payee {l['payee_id']} not in participants.csv")
        if l["source_kind"] in ("retail_sale", "downline_volume", "enrolment_order", "clawback") and l["source_order_id"] not in order_ids:
            err("srcorder", f"{where}: source_order_id '{l['source_order_id']}' not in orders.csv "
                            f"(order-level lines are needed for R2 and R3)")
    for cat, n in seen.items():
        if n > 1 and cat != "norefmonth":
            errors.append(f"  ... the problem above ({cat}) occurs {n} times in total")
    odd = {k: v for k, v in kinds.items() if k not in SOURCES}
    if odd:
        errors.append(f"payout_lines.csv: source_kind values outside {sorted(SOURCES)}: {odd}")
    if kinds.get("other", 0) > 0.2 * max(1, sum(kinds.values())):
        warnings.append("more than 20% of payout lines are 'other'; R3 will not say much")
    return report(errors, warnings, len(people), len(orders), len(lines))


def report(errors, warnings, n_p=0, n_o=0, n_l=0):
    if n_p:
        print(f"read {n_p} participants, {n_o} orders, {n_l} payout lines")
    for e in errors:
        print("ERROR  ", e)
    for w in warnings:
        print("WARNING", w)
    print("RESULT ", "usable" if not errors else "not usable until the errors are fixed")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "data_synthetic"))
