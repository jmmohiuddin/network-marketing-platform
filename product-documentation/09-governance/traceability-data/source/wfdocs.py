import json,os
B=os.path.dirname(os.path.abspath(__file__)); ROOT=os.environ.get("DOC_OUT") or os.path.abspath(os.path.join(B,"..","..","..")); OUT=ROOT+"/06-wireframes"
idx=json.load(open(B+"/wf_index.json")); spec=json.load(open(ROOT+"/09-governance/traceability-data/spec.json"))
SC={s["id"]:s for s in spec["screens"]}; FRS=spec["requirements"]
def frs(sid): return ", ".join(f["id"] for f in FRS if sid in f["scr"]) or "—"
REL={"A":"MVP-A","B":"MVP-B","V1":"V1"}
def head(t,sub,did): return f"# {t}\n## {sub}\n\n| Field | Value |\n|---|---|\n| Document ID | {did} |\n| Version | 0.1 (draft for founder review) |\n| Last updated | 2026-11-12 |\n| Owner | UX architect role |\n| Depends on | WF-01 (inventory), WF-02 (specification), UX-02, UX-05 |\n| Status | Draft. Low-fidelity structure only: no colour, brand or final copy. Not usability-tested |\n\n"
def block(sid, mobile=False, tmpl="T1 staff shell"):
    s=SC[sid]; w=idx.get(sid)
    o=f"### {sid} — {s['name']}\n\n"
    if w:
        if not mobile: o+=f"![{sid} {s['name']} wireframe]({w['file']})\n\n"
        if w.get("mobile") and mobile: o+=f"<img src=\"{w['mobile']}\" alt=\"{sid} mobile wireframe\" width=\"300\">\n\n"
    else: o+="*No drawn wireframe. Structure specified below.*\n\n"
    o+="| Aspect | Specification |\n|---|---|\n"
    o+=f"| Release / requirements | {REL.get(s['rel'],s['rel'])} / {frs(sid)} |\n| Layout template | {tmpl} |\n| Main content | {s['info']} |\n| Components (cards, tables, charts, forms, filters) | {s['components']} |\n| Primary button | {s['primary']} |\n| Secondary and contextual actions | {s['secondary']} |\n| Entry and exits | From: {s['entry']}. To: {s['goes']} |\n| Permissions | {s['perms']} |\n"
    notes=(w or {}).get("mnotes" if mobile else "notes",[])
    if notes: o+="\n"+"".join(f"- {n}\n" for n in notes)
    return o+"\n"
adm=[k for k in SC if SC[k]["area"] in ("Admin","Shared","Vendor")]
o=head("03 — ADMIN WIREFRAMES","Staff application and vendor console: low-fidelity wireframes and per-screen structure","WF-03")
o+="Wireframes are SVG files in `wireframes/`, generated from layout specifications; grey boxes are placeholders for data. Template **T1** (staff shell: top bar, left sidebar, content) is defined in WF-02 §2. The sidebar in each drawing shows the navigation of the release the screen belongs to (three items in MVP-A, eleven in MVP-B).\n\n"
groups=[("MVP-A: compliance overlay",["SC-46","SC-24","SC-25","SC-10","SC-26","SC-27","SC-28","SC-14","SC-30","SC-39"]),
("Periods and runs",["SC-01","SC-02","SC-32"]),("Plans",["SC-04","SC-05","SC-42","SC-44"]),("People and genealogy",["SC-36","SC-09","SC-07","SC-08","SC-43"]),
("Orders and cases",["SC-31","SC-06","SC-15"]),("Payouts and finance",["SC-03","SC-34","SC-33","SC-12"]),("Compliance (engine releases)",["SC-11","SC-23","SC-45"]),
("Data and settings",["SC-16","SC-17","SC-13","SC-29","SC-35","SC-47"])]
done=set()
for i,(g,ids) in enumerate(groups,1):
    o+=f"## {i}. {g}\n\n"
    for sid in ids:
        t="T4 centred card" if sid=="SC-27" else ("T1 staff shell (vendor console variant)" if sid=="SC-39" else "T1 staff shell")
        o+=block(sid,False,t); done.add(sid)
missing=[a for a in adm if a not in done]
assert not missing, missing
open(OUT+"/03_ADMIN_WIREFRAMES.md","w").write(o)
dist=["SC-37","SC-18","SC-19","SC-20","SC-21","SC-22","SC-38"]
o=head("04 — DISTRIBUTOR WIREFRAMES","Distributor portal at desktop and tablet width","WF-04")
o+="The portal is designed phone-first (WF-06). This document shows the same screens at desktop width using template **T2** (portal: top navigation, single centred column of at most 720 px). Content and order are identical to the phone layouts; nothing is added on larger screens except side-by-side placement of the line explanation.\n\n```mermaid\nflowchart LR\n  H[Home SC-37] --> S[Statement SC-18] --> X[Line explanation] --> D[Dispute]\n  H --> R[Rank SC-19]\n  H --> C[Customers SC-21]\n  H --> T[Team SC-20]\n  H --> M[More] --> P[Payment details SC-22]\n  M --> N[Notifications SC-38]\n```\n\n"
for sid in dist: o+=block(sid,False,"T2 portal")
o+="## Content rules for all portal screens\n\n- Net pay first, then how it was reached.\n- Committed data only; open periods show status, never estimates.\n- No income projection, potential earnings, next-rank prompt or recruit count (BR-HON-01).\n- Every limit is explained (visibility policy, cooling-off, holds).\n- Local language and locale formats from the market pack.\n"
open(OUT+"/04_DISTRIBUTOR_WIREFRAMES.md","w").write(o)
o=head("05 — CUSTOMER WIREFRAMES","Customer-facing touchpoints, and why there are so few","WF-05")
o+="""## 1. Scope decision

Retail customers are **not users of this product**. Under the chosen product boundary the storefront, customer account, order history, subscription management and customer support belong to the tenant's commerce platform and help desk (integrated, not built: GAP-045, GAP-046). Customers exist in the platform as participants of a type flagged *counts as end customer*, with a servicing relationship, so that attribution and the retail-customer share are correct.

| Brief screen | Decision | Where the need is met |
|---|---|---|
| Customer storefront | Not built | Tenant's commerce platform; orders arrive through the ingestion API |
| Customer account, order history | Not built | Commerce platform |
| Subscription management | Not built | Commerce platform (merchant of record holds consent records); V1 consumes subscription events |
| Customer support | Not built | Tenant's help desk; the platform's cases cover pay, genealogy and privacy only |
| Purpose tag at checkout (resale or personal use, for participant orders) | **Specified as a contract**, not a screen | Connector passes `purpose`; where the store cannot ask, the order is stored as unspecified and counted in data-quality figures |
| Attribution (which distributor served this customer) | Contract | Link or code captured by the store and passed as an attribution hint |

Two public pages are customer-facing:

"""
o+=block("SC-41",False,"T4 centred card")
o+="**Phone layout**\n\n"+block("SC-41",True,"T3 phone, no bottom navigation").split("\n\n",1)[1]
o+=block("SC-40",False,"T4 single column, public")
o+="""Structure of SC-40 (V1): tenant name and "Earnings disclosure for [year]"; one-sentence plain summary (for example the share of participants who received any commission); table of bands with the number and share of participants in each, **including the zero band**; basis statement (gross commissions net of clawbacks, before expenses); population definition; version and publication date; language switch. No call to action to join.

## 2. If the boundary changes

If interviews show buyers want one vendor for commerce and compensation (the condition named in GAP-045), a storefront, customer account and subscription screens would become a separate product increment with their own inventory. Nothing in the current data model prevents it: customers, servicing and orders already exist.
"""
open(OUT+"/05_CUSTOMER_WIREFRAMES.md","w").write(o)
o=head("06 — MOBILE WIREFRAMES","Phone layouts for the distributor portal and public pages; mobile behaviour of staff approvals","WF-06")
o+="Phone wireframes use template **T3** (360 px wide: top bar with back and title, one content column with 16 px margins, bottom navigation of at most five items). They are drawn at the smallest supported width; larger phones gain only margin.\n\n## 1. Distributor portal on a phone\n\n"
for sid in ["SC-27","SC-37","SC-18","SC-19","SC-20","SC-21","SC-22"]: o+=block(sid,True,"T3 phone")
o+="""## 2. Mobile rules

| Topic | Rule |
|---|---|
| Navigation | Bottom bar: Home · Earnings · Rank · Customers · More. Team sits under More unless the participant type can sponsor and has a downline, in which case it replaces Customers |
| Reach | Primary action in the lower half of the screen; targets at least 44 × 44 px; 8 px minimum spacing |
| Tables | Become stacked cards with the three most important fields; the rest behind a tap |
| Detail | Opens as a full-screen page or a bottom sheet (line explanation, filters) instead of a drawer |
| Forms | One question group per screen; correct keyboard type; values kept on connection loss |
| Trees | List drill-in with counts, never a drawn tree |
| Weight | Server-rendered; statement core readable without scripts; page budget NFR-PERF-06 |
| Offline | Last loaded content with its time; actions that need the server say so |
| Language | Market languages; text can grow 40% without breaking layout; right-to-left ready |
| Installable | The portal can be added to the home screen; no native app in MVP (mobile need unverified, P-09) |

## 3. Staff application on small screens

The staff application targets 1024 px and wider. Two tasks are supported on tablets and, in read-and-approve form, on phones, because approvers may be away from a desk:

| Task | Small-screen behaviour |
|---|---|
| Approve a run commit (SC-02) | Summary sentence, totals and variance cards, exception list as cards, approval bar pinned to the bottom, step-up authentication; tables reduce to bonus, amount and change |
| Approve a payout batch (SC-03) | Totals, counts, exclusion reasons with counts, approval bar pinned; per-payee lists paged |
| Decide a vendor access request (SC-14) | Request card with approve or deny |

All other staff screens show a notice below 1024 px: the page is usable with horizontal scrolling of tables but is not optimised. **No separate mobile layouts are drawn for staff screens**; this is recorded as a known limit in the readiness report.

## 4. Screens without a phone layout

SC-38 (notifications and profile) follows the list pattern of SC-21 and is specified in text only.
"""
open(OUT+"/06_MOBILE_WIREFRAMES.md","w").write(o)
print("ok")
