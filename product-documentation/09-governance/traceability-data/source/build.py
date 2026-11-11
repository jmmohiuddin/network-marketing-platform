#!/usr/bin/env python3
"""Generates the structured product documents from one source of truth so IDs cannot drift."""
import os, re, json, sys, collections
B = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("DOC_OUT") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
DATE = "2026-11-12"
REL = {"A": "MVP-A", "B": "MVP-B", "B-MKT": "MVP-B (market pack)", "V1": "V1", "V2": "V2", "ENT": "Enterprise"}
MOD = {"IAM": "Identity and access", "TEN": "Tenant and market configuration", "IMP": "Data import (overlay)", "CPL": "Compliance analytics and guardrails",
       "PAR": "Participants", "GEN": "Genealogy", "ORD": "Orders and returns", "CRM": "Customer attribution", "PLN": "Plans",
       "COMP": "Calculation engine", "FIN": "Obligations ledger", "PAY": "Payouts", "TAX": "Tax", "CAS": "Cases",
       "DIST": "Distributor portal", "PRV": "Privacy", "AUD": "Audit", "INT": "Integration", "RPT": "Reporting",
       "MIG": "Migration", "OPS": "Vendor operations", "AI": "AI assistance", "LIC": "Editions and licensing"}
errors = []

def read(n):
    return open(os.path.join(B, n), encoding="utf-8").read()

def blocks(text):
    cur = None; out = []
    for ln in text.splitlines():
        if ln.startswith("#") or not ln.strip():
            continue
        if ln.startswith("@"):
            cur = {"_h": [x.strip() for x in ln[1:].split("|")], "_l": []}
            out.append(cur)
        elif cur is not None:
            k, _, v = ln.partition(":")
            cur["_l"].append((k.strip(), v.strip()))
    return out

def lst(s):
    return [x.strip() for x in s.split(",") if x.strip() and x.strip() != "None"]

# ---------- parse ----------
FR = collections.OrderedDict()
for f in ("fr1.txt", "fr2.txt", "fr3.txt"):
    for b in blocks(read(f)):
        i, rel, pri, title, mod = b["_h"]
        d = dict(b["_l"]); d.update(id=i, rel=rel, pri=pri, title=title, mod=mod)
        for k in ("trace", "br", "us", "scr", "api", "ent", "dep"):
            d[k] = lst(d.get(k, ""))
        FR[i] = d
US = collections.OrderedDict(); AC = collections.OrderedDict()
for b in blocks(read("stories.txt")):
    i, rel, persona, want, so = b["_h"]
    d = {"id": i, "rel": rel, "persona": persona, "want": want, "so": so, "ac": []}
    for k, v in b["_l"]:
        if k == "ac":
            a = [x.strip() for x in v.split("|")]
            AC[a[0]] = {"id": a[0], "us": i, "given": a[1], "when": a[2], "then": a[3]}
            d["ac"].append(a[0])
        else:
            d[k] = v
    US[i] = d
BR = collections.OrderedDict(); BRG = []
for ln in read("br.txt").splitlines():
    if ln.startswith("#G "):
        g = [x.strip() for x in ln[3:].split("|")]; BRG.append({"code": g[0], "title": g[1], "note": g[2] if len(g) > 2 else "", "rules": []})
    elif ln.startswith("#") or not ln.strip():
        continue
    else:
        p = [x.strip() for x in ln.split("|")]
        BR[p[0]] = dict(id=p[0], rule=p[1], at=p[2], basis=p[3], status=p[4], rel=p[5]); BRG[-1]["rules"].append(p[0])
TS = collections.OrderedDict()
for ln in read("tests.txt").splitlines():
    if ln.startswith("#") or not ln.strip(): continue
    p = [x.strip() for x in ln.split("|")]
    TS[p[0]] = dict(id=p[0], layer=p[1], scenario=p[2], expected=p[3], refs=lst(p[4]), rel=p[5])
SC = collections.OrderedDict()
SCK = "id name area rel personas objective goal entry primary secondary info components perms goes wf".split()
for ln in read("screens.txt").splitlines():
    if ln.startswith("#") or not ln.strip(): continue
    p = [x.strip() for x in ln.split("|")]
    SC[p[0]] = dict(zip(SCK, p))
API = collections.OrderedDict()
for ln in read("apis.txt").splitlines():
    if ln.startswith("#") or not ln.strip(): continue
    p = [x.strip() for x in ln.split("|")]
    API[p[0]] = dict(zip("id path purpose auth authz idem rel".split(), p))
ENT = collections.OrderedDict()
for b in blocks(read("entities.txt")):
    n, owner, ent, rel, scoped, purpose = b["_h"]
    d = dict(b["_l"]); d.update(name=n, owner=owner, ent=ent, rel=rel, scoped=scoped, purpose=purpose)
    cols = []
    for c in d["c"].split(";"):
        t = c.split()
        if not t: continue
        fk = [x[3:] for x in t[2:] if x.startswith("FK>")]
        cols.append(dict(name=t[0], type=t[1], flags=[x for x in t[2:] if not x.startswith("FK>")], fk=fk[0] if fk else None))
    d["cols"] = cols
    ENT[n] = d

# ---------- validate ----------
def chk(cond, msg):
    if not cond: errors.append(msg)
for f in FR.values():
    for u in f["us"]: chk(u in US, f"{f['id']}: unknown story {u}")
    for s in f["scr"]: chk(s in SC, f"{f['id']}: unknown screen {s}")
    for a in f["api"]: chk(a in API, f"{f['id']}: unknown api {a}")
    for e in f["ent"]: chk(e in ENT, f"{f['id']}: unknown entity {e}")
    for r in f["br"]: chk(r in BR, f"{f['id']}: unknown rule {r}")
    for x in f["dep"]: chk(x in FR, f"{f['id']}: unknown dependency {x}")
for t in TS.values():
    for r in t["refs"]:
        chk(r in AC or r in BR, f"{t['id']}: unknown ref {r}")
for e in ENT.values():
    for c in e["cols"]:
        if c["fk"]: chk(c["fk"] in ENT, f"{e['name']}: FK to unknown {c['fk']}")
for s in SC.values():
    for g in lst(s["goes"]):
        chk(g in SC or g in ("—", "role home"), f"{s['id']}: goes to unknown {g}")
if errors:
    print("\n".join(errors)); sys.exit(1)

# ---------- derived ----------
us_fr = collections.defaultdict(list)
for f in FR.values():
    for u in f["us"]: us_fr[u].append(f["id"])
scr_fr = collections.defaultdict(list); api_fr = collections.defaultdict(list); ent_fr = collections.defaultdict(list); br_fr = collections.defaultdict(list)
for f in FR.values():
    for s in f["scr"]: scr_fr[s].append(f["id"])
    for a in f["api"]: api_fr[a].append(f["id"])
    for e in f["ent"]: ent_fr[e].append(f["id"])
    for r in f["br"]: br_fr[r].append(f["id"])
ref_ts = collections.defaultdict(list)
for t in TS.values():
    for r in t["refs"]: ref_ts[r].append(t["id"])
def fr_acs(f): return [a for u in f["us"] for a in US[u]["ac"]]
def fr_tests(f):
    s = []
    for r in fr_acs(f) + f["br"]:
        for t in ref_ts.get(r, []):
            if t not in s: s.append(t)
    return sorted(s)

def w(path, text):
    p = os.path.join(OUT, path); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w", encoding="utf-8").write(text.rstrip() + "\n")

def head(title, sub, docid, deps, extra=""):
    return (f"# {title}\n## {sub}\n\n| Field | Value |\n|---|---|\n| Document ID | {docid} |\n| Version | 0.1 (draft for founder review) |\n"
            f"| Last updated | {DATE} |\n| Owner | Product (CPO role) |\n| Depends on | {deps} |\n| Status | Draft. Not approved |\n{extra}\n")
def j(xs, sep=", "): return sep.join(xs) if xs else "—"
def static(n):
    p = os.path.join(B, "static", n)
    return open(p, encoding="utf-8").read().rstrip() + "\n\n" if os.path.exists(p) else ""

# ---------- 02 FUNCTIONAL REQUIREMENTS ----------
o = head("02 — FUNCTIONAL REQUIREMENTS", "Every functional capability, by module, with full requirement records", "PRD-02",
         "PRD-01, PRD-04 (business rules), PRD-05/06 (stories, acceptance), research gap audit 22–29")
o += static("fr.head.md")
cnt = collections.Counter(f["rel"] for f in FR.values())
o += "## 1. Summary\n\n| Release | Requirements |\n|---|---|\n" + "".join(f"| {REL[k]} | {v} |\n" for k, v in cnt.items()) + f"| **Total** | **{len(FR)}** |\n\n"
o += "| Module | Prefix | MVP-A | MVP-B | Later |\n|---|---|---|---|---|\n"
for m, name in MOD.items():
    fs = [f for f in FR.values() if f["mod"] == m]
    if not fs: continue
    o += f"| {name} | FR-{m} | {sum(f['rel']=='A' for f in fs)} | {sum(f['rel'] in ('B','B-MKT') for f in fs)} | {sum(f['rel'] in ('V1','V2','ENT') for f in fs)} |\n"
o += "\n## 2. Requirement index\n\n| ID | Title | Release | Priority |\n|---|---|---|---|\n"
for f in FR.values(): o += f"| {f['id']} | {f['title']} | {REL[f['rel']]} | {f['pri']} |\n"
o += "\n## 3. Requirement records\n"
cur = None
for f in FR.values():
    if f["mod"] != cur:
        cur = f["mod"]; o += f"\n### 3.{list(MOD).index(cur)+1} {MOD[cur]} (FR-{cur})\n"
    acs = fr_acs(f)
    o += (f"\n#### {f['id']} — {f['title']}\n\n| Field | Content |\n|---|---|\n"
          f"| Release / priority | {REL[f['rel']]} / {f['pri']} |\n| Description | {f['desc']} |\n| Business justification | {f['why']} |\n"
          f"| Traces to (research) | {j(f['trace'])} |\n| User role | {f['persona']} |\n| Preconditions | {f['pre']} |\n| Trigger | {f['trigger']} |\n"
          f"| Inputs | {f['in']} |\n| Processing logic | {f['logic']} |\n| Expected outputs | {f['out']} |\n| Business rules | {j(f['br'])} |\n"
          f"| Validation rules | {f['valid']} |\n| Error scenarios | {f['err']} |\n| Permissions | {f['perm']} |\n| Dependencies | {j(f['dep'])} |\n"
          f"| User stories | {j(f['us'])} |\n| Acceptance criteria | {j(acs) if acs else '**None yet** (listed in traceability gaps)'} |\n"
          f"| Screens / APIs / Entities | {j(f['scr'])} / {j(f['api'])} / {j(['`'+e+'`' for e in f['ent']])} |\n")
w("02-prd/02_FUNCTIONAL_REQUIREMENTS.md", o)

# ---------- 04 BUSINESS RULES ----------
o = head("04 — BUSINESS RULES", "The rule catalogue: where each rule is set, its basis and how sure we are", "PRD-04", "Research 13, 51; gap audit 24; Phase A P1")
o += static("br.head.md")
for g in BRG:
    o += f"\n### BR-{g['code']} — {g['title']}\n\n{g['note']}\n\n| ID | Rule | At | Basis | Status | Release | Used by | Tests |\n|---|---|---|---|---|---|---|---|\n"
    for r in g["rules"]:
        x = BR[r]; o += f"| {r} | {x['rule']} | {x['at']} | {x['basis']} | {x['status']} | {REL[x['rel']]} | {j(br_fr.get(r, []))} | {j(ref_ts.get(r, []))} |\n"
o += "\n" + static("br.tail.md")
w("02-prd/04_BUSINESS_RULES.md", o)

# ---------- 05 USER STORIES ----------
o = head("05 — USER STORIES", "Stories with flows, tied to requirements and acceptance criteria", "PRD-05", "PRD-02, PRD-06; gap audit 25")
o += static("us.head.md")
for u in US.values():
    o += (f"\n### {u['id']} — {u['persona']}\n\n**As a** {u['persona'].lower()}, **I want** {u['want']}, **so that** {u['so']}.\n\n| Field | Content |\n|---|---|\n"
          f"| Release | {REL[u['rel']]} |\n| Business value | {u.get('value','')} |\n| Preconditions | {u.get('pre','')} |\n"
          f"| Main flow | {' → '.join(x.strip() for x in u.get('main','').split(';'))} |\n| Alternative flows | {u.get('alt','')} |\n"
          f"| Acceptance criteria | {j(u['ac'])} |\n| Requirements | {j(us_fr.get(u['id'], []))} |\n| Dependencies | {u.get('dep','')} |\n")
w("02-prd/05_USER_STORIES.md", o)

# ---------- 06 ACCEPTANCE CRITERIA ----------
o = head("06 — ACCEPTANCE CRITERIA", "Given / When / Then criteria that QA can verify independently", "PRD-06", "PRD-05; gap audit 26; QA-02")
o += static("ac.head.md")
o += "| AC | Story | Given | When | Then | Tests |\n|---|---|---|---|---|---|\n"
for a in AC.values():
    o += f"| {a['id']} | {a['us']} | {a['given']} | {a['when']} | {a['then']} | {j(ref_ts.get(a['id'], [])) if ref_ts.get(a['id']) else '**none**'} |\n"
w("02-prd/06_ACCEPTANCE_CRITERIA.md", o)

# ---------- DATABASE DESIGN ----------
o = head("04 — DATABASE DESIGN", "Every table: purpose, columns, keys, constraints, indexes, tenant ownership, audit", "SDD-04", "SDD-01, SDD-05 (ER diagrams), PRD-04; gap audit 28")
o += static("db.head.md")
o += "## 3. Table catalogue\n\n| Table | Owner module | Research entity | Release | Tenant-scoped | Purpose |\n|---|---|---|---|---|---|\n"
for e in ENT.values():
    o += f"| `{e['name']}` | {MOD[e['owner']]} | {e['ent']} | {REL[e['rel']]} | {e['scoped']} | {e['purpose']} |\n"
o += "\n## 4. Table definitions\n"
cur = None
for e in sorted(ENT.values(), key=lambda e: list(MOD).index(e["owner"])):
    if e["owner"] != cur:
        cur = e["owner"]; o += f"\n### 4.{list(MOD).index(cur)+1} {MOD[cur]}\n"
    o += f"\n#### `{e['name']}`\n\n{e['purpose']}. Release: {REL[e['rel']]}. Used by: {j(ent_fr.get(e['name'], []))}.\n\n| Column | Type | Key / null | References |\n|---|---|---|---|\n"
    for c in e["cols"]:
        fl = " ".join(x.replace("NN", "NOT NULL").replace("UQ", "UNIQUE") for x in c["flags"]) or "null"
        o += f"| `{c['name']}` | {c['type']} | {fl} | {('`'+c['fk']+'`.id') if c['fk'] else ''} |\n"
    o += f"\n- **Indexes:** {e.get('i','—')}\n- **Constraints and invariants:** {e.get('k','—')}\n- **Tenant ownership:** {'row-level security on `tenant_id`' if e['scoped']=='Y' else 'platform-level table (no tenant data)'}\n- **Audit:** {e.get('a','standard')}\n"
o += "\n" + static("db.tail.md")
w("04-system-design/04_DATABASE_DESIGN.md", o)

# ---------- ER DIAGRAMS ----------
def er(names, title):
    s = f"### {title}\n\n```mermaid\nerDiagram\n"
    seen = set()
    for n in names:
        e = ENT[n]
        for c in e["cols"]:
            if c["fk"] and c["fk"] in names and c["fk"] != n and c["name"] != "tenant_id":
                k = (c["fk"], n, c["name"])
                if k in seen: continue
                seen.add(k)
                s += f"  {c['fk'].upper()} ||--o{{ {n.upper()} : \"{c['name'].replace('_id','')}\"\n"
    for n in names:
        e = ENT[n]; s += f"  {n.upper()} {{\n"
        for c in e["cols"][:9]:
            t = re.sub(r"[^a-z0-9]", "", c["type"].split("(")[0]) or "text"
            key = " PK" if "PK" in c["flags"] else (" FK" if c["fk"] else "")
            s += f"    {t} {c['name']}{key}\n"
        s += "  }\n"
    return s + "```\n\n"
o = head("05 — ER DIAGRAMS", "Entity-relationship diagrams by domain, generated from the table definitions", "SDD-05", "SDD-04")
o += ("Diagrams are generated from the same source as `04_DATABASE_DESIGN.md`, so they cannot disagree with it. Each entity box shows up to nine columns; "
      "the full list is in the database design. `tenant_id` foreign keys are omitted from the diagrams because every tenant-scoped table has one.\n\n")
o += er(["tenant", "market", "brand", "tenant_setting_version", "user_account", "role", "role_assignment", "approval", "support_session", "api_key"], "1. Tenancy, identity and access")
o += er(["import_batch", "import_mapping", "import_row_error", "cpl_fact_participant", "cpl_fact_order", "cpl_fact_payout_line", "compliance_report_snapshot", "compliance_figure", "guardrail_rule", "guardrail_decision"], "2. Overlay import and compliance (MVP-A)")
o += er(["participant", "participant_type", "participant_type_assignment", "position", "position_ownership", "relationship", "path_node", "customer_servicing", "agreement_acceptance"], "3. Participants, positions and genealogy")
o += er(["order", "order_line", "order_event", "late_transaction", "product_volume_map", "period", "participant", "position"], "4. Orders, returns and attribution")
o += er(["plan", "plan_version", "plan_rule", "plan_transition", "golden_dataset", "simulation", "calendar", "period", "run", "run_snapshot", "result_line", "qualification_state", "restatement"], "5. Plans, periods and calculation")
o += er(["ledger_account", "journal_entry", "posting", "payout_batch", "payout_instruction", "provider_config", "bank_detail_version", "tax_profile", "tax_rule", "tax_line", "tax_form", "run", "participant"], "6. Ledger, payouts and tax")
o += er(["case", "case_event", "approval", "privacy_request", "statement", "notification", "document", "outbox_event", "webhook_endpoint", "webhook_delivery", "export_job"], "7. Cases, privacy, notifications and integration")
w("04-system-design/05_ER_DIAGRAMS.md", o)

# ---------- SCREEN INVENTORY ----------
o = head("01 — SCREEN INVENTORY", "Master list of screens with purpose, content, permissions and trace", "WF-01", "UX-02 (IA), PRD-02; gap audit 27")
o += static("sc.head.md")
o += "## 2. Index\n\n| ID | Screen | Area | Release | Wireframe | Requirements |\n|---|---|---|---|---|---|\n"
for s in SC.values():
    o += f"| {s['id']} | {s['name']} | {s['area']} | {REL[s['rel']]} | {'Yes' if s['wf']=='Y' else 'Specified in text only'} | {j(scr_fr.get(s['id'], []))} |\n"
o += "\n## 3. Screen records\n"
for s in SC.values():
    ents = sorted({e for f in scr_fr.get(s["id"], []) for e in FR[f]["ent"]})
    o += (f"\n### {s['id']} — {s['name']}\n\n| Field | Content |\n|---|---|\n| Module / area | {s['area']} |\n| Release | {REL[s['rel']]} |\n| Target persona | {s['personas']} |\n"
          f"| Business objective | {s['objective']} |\n| User goal | {s['goal']} |\n| Entry point | {s['entry']} |\n| Primary action | {s['primary']} |\n| Secondary actions | {s['secondary']} |\n"
          f"| Information displayed | {s['info']} |\n| Components | {s['components']} |\n| Data required | {j(['`'+e+'`' for e in ents])} |\n| Permissions | {s['perms']} |\n"
          f"| Navigation destinations | {s['goes']} |\n| Related requirements | {j(scr_fr.get(s['id'], []))} |\n| Wireframe | {'`wireframes/'+s['id']+'.svg`' if s['wf']=='Y' else 'Not drawn; behaviour specified here and in WF-02'} |\n")
o += "\n" + static("sc.tail.md")
w("06-wireframes/01_SCREEN_INVENTORY.md", o)

# ---------- TEST SCENARIOS ----------
o = head("02 — TEST SCENARIOS", "The test catalogue with expected results and the criteria and rules each test proves", "QA-02", "QA-01, PRD-06, PRD-04; gap audit 30")
o += static("ts.head.md")
o += "| ID | Layer | Scenario | Expected result | Proves | Release |\n|---|---|---|---|---|---|\n"
for t in TS.values():
    o += f"| {t['id']} | {t['layer']} | {t['scenario']} | {t['expected']} | {j(t['refs'])} | {REL[t['rel']]} |\n"
o += "\n" + static("ts.tail.md")
w("08-qa/02_TEST_SCENARIOS.md", o)

# ---------- TRACEABILITY ----------
GAPT = {}
p = os.path.join(B, "gaps.json")
if os.path.exists(p): GAPT = json.load(open(p))
o = head("04 — REQUIREMENTS TRACEABILITY", "Problem → need → feature → requirement → story → acceptance → screen → API → entity → test, with the disconnected items listed", "QA-04 (also satisfies deliverable 07_REQUIREMENTS_TO_DESIGN_TRACEABILITY)", "All PRD, SDD, wireframe and QA documents")
o += static("tr.head.md")
o += "## 2. Forward trace matrix\n\n| Requirement | Release | Research trace (problem, gap, feature, compliance) | Stories | Acceptance | Screens | APIs | Entities | Tests |\n|---|---|---|---|---|---|---|---|---|\n"
for f in FR.values():
    o += f"| {f['id']} {f['title']} | {REL[f['rel']]} | {j(f['trace'])} | {j(f['us'])} | {j(fr_acs(f))} | {j(f['scr'])} | {j(f['api'])} | {j(f['ent'])} | {j(fr_tests(f))} |\n"
# critical chains
o += "\n" + static("tr.mid.md")
mvp = lambda r: r in ("A", "B", "B-MKT")
g1 = [f for f in FR.values() if not f["scr"]]
g2 = [s for s in SC.values() if not scr_fr.get(s["id"])]
g3 = [f for f in FR.values() if not fr_acs(f)]
g4 = [a for a in AC.values() if not ref_ts.get(a["id"])]
g5 = [r for r in BR.values() if not ref_ts.get(r["id"])]
g6 = [r for r in BR.values() if not br_fr.get(r["id"])]
g7 = [a for a in API.values() if not api_fr.get(a["id"])]
g8 = [e for e in ENT.values() if not ent_fr.get(e["name"])]
g9 = [f for f in FR.values() if not fr_tests(f)]
g10 = [u for u in US.values() if not us_fr.get(u["id"])]
def sec(n, title, items, fmt, note):
    s = f"\n### 4.{n} {title}\n\n{note}\n\n"
    if not items: return s + "None.\n"
    return s + "".join("- " + fmt(i) + "\n" for i in items)
o += "## 4. Disconnected items (generated; nothing is hidden)\n"
o += sec(1, "Requirements without screens", g1, lambda f: f"{f['id']} {f['title']} ({REL[f['rel']]})", "A requirement can legitimately have no screen when it is a system behaviour; each one below must be confirmed as such.")
o += sec(2, "Screens without requirements", g2, lambda s: f"{s['id']} {s['name']}", "A screen with no requirement must be removed or a requirement written.")
o += sec(3, "Requirements without acceptance criteria", g3, lambda f: f"{f['id']} {f['title']} ({REL[f['rel']]})", "By the gate rule in the research (22 §2) these are **not ready**. All are post-MVP unless marked.")
o += sec(4, "Acceptance criteria without a test", g4, lambda a: f"{a['id']} ({a['us']})", "Every criterion should be proven by at least one test scenario.")
o += sec(5, "Business rules without a test", g5, lambda r: f"{r['id']} ({REL[r['rel']]}, status {r['status']}): {r['rule'][:110]}", "Rules needing a test before the release in which they apply.")
o += sec(6, "Business rules not referenced by any requirement", g6, lambda r: f"{r['id']} ({REL[r['rel']]})", "Either a requirement should enforce the rule or the rule is context only.")
o += sec(7, "APIs without a requirement", g7, lambda a: f"{a['id']} {a['path']}", "An API with no business justification must be removed.")
o += sec(8, "Entities not referenced by any requirement", g8, lambda e: f"`{e['name']}` (owner {MOD[e['owner']]})", "Each has an owner module; listed so that purpose is confirmed.")
o += sec(9, "Requirements with no test at all", g9, lambda f: f"{f['id']} {f['title']} ({REL[f['rel']]})", "")
o += sec(10, "Stories without a requirement", g10, lambda u: u["id"], "")
o += "\n" + static("tr.tail.md")
w("08-qa/04_REQUIREMENTS_TRACEABILITY.md", o)

# API catalogue fragment and machine-readable spec
frag = "| ID | Method and path | Purpose | Authentication | Authorisation | Idempotency | Release | Requirements |\n|---|---|---|---|---|---|---|---|\n"
for a in API.values():
    frag += f"| {a['id']} | `{a['path']}` | {a['purpose']} | {a['auth']} | {a['authz']} | {a['idem']} | {REL[a['rel']]} | {j(api_fr.get(a['id'], []))} |\n"
w("04-system-design/06_API_DESIGN.md", static("api.head.md").rstrip("\n") + "\n" + frag + "\n" + static("api.tail.md"))
spec = dict(requirements=list(FR.values()), stories=list(US.values()), acceptance=list(AC.values()), rules=list(BR.values()), tests=list(TS.values()),
            screens=list(SC.values()), apis=list(API.values()), entities=[{k: v for k, v in e.items() if k != "c"} for e in ENT.values()])
w("09-governance/traceability-data/spec.json", json.dumps(spec, indent=1, ensure_ascii=False))
stats = dict(FR=len(FR), US=len(US), AC=len(AC), BR=len(BR), TS=len(TS), SC=len(SC), API=len(API), ENT=len(ENT),
             rel=dict(cnt), gaps=dict(fr_no_screen=len(g1), screen_no_fr=len(g2), fr_no_ac=len(g3), ac_no_test=len(g4), br_no_test=len(g5), br_no_fr=len(g6), api_no_fr=len(g7), ent_no_fr=len(g8), fr_no_test=len(g9), us_no_fr=len(g10)),
             fr_no_ac=[f["id"]+" ("+f["rel"]+")" for f in g3], br_no_test=[r["id"] for r in g5], ac_no_test=[a["id"] for a in g4], ent_no_fr=[e["name"] for e in g8], br_no_fr=[r["id"] for r in g6],
             wf=[s["id"] for s in SC.values() if s["wf"] == "Y"])
json.dump(stats, open(os.path.join(B, "stats.json"), "w"), indent=1)
print(json.dumps(stats, indent=1))
