import re,glob,os,json,collections
OUT=os.environ.get("DOC_OUT") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","..",".."))
spec=json.load(open(OUT+"/09-governance/traceability-data/spec.json")); st=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"stats.json")))
ids={"FR":{f["id"] for f in spec["requirements"]},"US":{u["id"] for u in spec["stories"]},"AC":{a["id"] for a in spec["acceptance"]},
     "BR":{r["id"] for r in spec["rules"]},"TS":{t["id"] for t in spec["tests"]},"SC":{s["id"] for s in spec["screens"]},"API":{a["id"] for a in spec["apis"]}}
files=sorted(glob.glob(OUT+"/**/*.md",recursive=True)); txt={f:open(f,encoding="utf-8").read() for f in files}
alltext="\n".join(txt.values())
pat={"FR":r"\bFR-[A-Z]+-\d{3}\b","US":r"\bUS-\d{2}\b","AC":r"\bAC-\d{2}\.\d\b","TS":r"\bTS-\d{2}\b","SC":r"\bSC-\d{2}\b","API":r"\bAPI-\d{2}\b","BR":r"\bBR-[A-Z]{3}-\d{2}\b"}
orig_br={"BR-TRM-03","BR-RNK-01","BR-RNK-03","BR-RNK-04","BR-REV-01","BR-REV-03","BR-REV-04","BR-REV-05","BR-PAY-01","BR-PAY-03","BR-PAY-04","BR-PAY-05","BR-PAY-07","BR-DAT-01","BR-DAT-02","BR-DAT-04","BR-DAT-05","BR-REG-01","BR-REG-02","BR-REG-03","BR-ORD-03","BR-VOL-02","BR-CMP-05","BR-CMP-07","BR-CPL-02","BR-CMP-03","BR-CMP-08"}
bad=collections.defaultdict(set)
for f,t in txt.items():
    for k,p in pat.items():
        for m in set(re.findall(p,t)):
            if m not in ids[k] and not (k=="BR" and m in orig_br): bad[os.path.relpath(f,OUT)].add(m)
print("UNKNOWN IDS:",{k:sorted(v) for k,v in bad.items()} or "none")
# OQ / DEC / ADR / UJ refs
oq=txt[OUT+"/09-governance/03_OPEN_QUESTIONS.md"]; dl=txt[OUT+"/09-governance/02_DECISION_LOG.md"]; uj=txt[OUT+"/05-ux/04_USER_JOURNEYS.md"]
def defined(t,p): return set(re.findall(p,t))
oqd=defined(oq,r"\| (OQ-\d{2}|FD-\d{2}|AQ-\d{2}|Q-\d{1,2})\b"); 
for lab,p,src in (("OQ",r"\bOQ-\d{2}\b",oq),("DEC",r"\bDEC-\d{2}\b",dl),("ADR",r"\bADR-\d{2}\b",dl),("UJ",r"\bUJ-\d{2}\b",uj),("FD",r"\bFD-\d{2}\b",oq)):
    used=set(re.findall(p,alltext)); have=set(re.findall(p,src)); print(lab,"used but not defined:",sorted(used-have) or "none")
# links and images
miss=[]
for f,t in txt.items():
    for m in re.findall(r"\]\(([^)#]+?)\)",t)+re.findall(r'src="([^"]+)"',t):
        if m.startswith("http"): continue
        if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f),m))): miss.append((os.path.relpath(f,OUT),m))
print("MISSING LINK TARGETS:",miss or "none")
# backticked doc file references
names={os.path.basename(f) for f in files}
refs=set(re.findall(r"`(?:[\w-]+/)?(\d\d_[A-Z_]+\.md)`",alltext)); print("doc refs not found:",sorted(r for r in refs if r not in names) or "none")
# roadmap coverage
rm=txt[OUT+"/02-prd/07_MVP_AND_PRODUCT_ROADMAP.md"]
def expand(t):
    s=set()
    for m in re.finditer(r"FR-([A-Z]+)-(\d{3})((?:(?:, | and |\.\.|, -|; )-?\d{3})*)",t):
        mod,first,rest=m.group(1),m.group(2),m.group(3); s.add(f"FR-{mod}-{first}")
        prev=int(first)
        for sep,n in re.findall(r"(\.\.|, -|, |; | and )-?(\d{3})",rest):
            n=int(n)
            if sep=="..": [s.add(f"FR-{mod}-{i:03d}") for i in range(prev,n+1)]
            else: s.add(f"FR-{mod}-{n:03d}")
            prev=n
    return s
cov=expand(rm)
need=[f["id"] for f in spec["requirements"]]
print("FRs not placed in roadmap:",[i for i in need if i not in cov] or "none")
# empty/small files
print("small files:",[os.path.relpath(f,OUT) for f in files if len(txt[f])<800] or "none")
print("files:",len(files),"words:",sum(len(t.split()) for t in txt.values()))
print({k:len(v) for k,v in ids.items()}, st["rel"], st["gaps"])
# edge-case summary
ec=txt[OUT+"/08-qa/03_EDGE_CASES.md"]; sec=None; cnt=collections.OrderedDict()
for ln in ec.splitlines():
    if ln.startswith("## ") and ln[3].isdigit(): sec=ln[3:].split(". ",1)[1]; cnt[sec]=[0,0,0,0]
    elif ln.startswith("| E-") and sec:
        last=[c.strip() for c in ln.strip().strip("|").split("|")][-1]; c=cnt[sec]; c[0]+=1
        if last=="—": c[3]+=1
        elif last.startswith("To add"): c[2]+=1
        else: c[1]+=1
print(json.dumps(cnt)); print("totals",[sum(v[i] for v in cnt.values()) for i in range(4)])
