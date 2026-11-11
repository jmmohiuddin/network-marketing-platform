import re,os,subprocess,sys,glob,hashlib,json
OUT=os.environ.get("DOC_OUT") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","..",".."))
cache={}
bad=0;n=0
for f in sorted(glob.glob(OUT+"/**/*.md",recursive=True)):
    t=open(f,encoding='utf-8').read()
    for i,m in enumerate(re.finditer(r"```mermaid\n(.*?)```",t,re.S)):
        src=m.group(1); h=hashlib.sha1(src.encode()).hexdigest(); n+=1
        if cache.get(h)=="ok": continue
        open('d.mmd','w').write(src)
        r=subprocess.run(["mmdc","-i","d.mmd","-o","d.svg","-q"],capture_output=True,text=True,timeout=120)
        ok = r.returncode==0 and os.path.exists('d.svg') and 'Syntax error' not in open('d.svg').read()
        if ok: cache[h]="ok"
        else:
            bad+=1; print("FAIL",os.path.relpath(f,OUT),"#%d"%i,(r.stderr or r.stdout)[:300].replace("\n"," | "))
        if os.path.exists('d.svg'): os.remove('d.svg')
print("diagrams",n,"bad",bad)
