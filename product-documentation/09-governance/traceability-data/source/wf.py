#!/usr/bin/env python3
"""Low-fidelity wireframe generator: one SVG per screen from a compact layout spec."""
import os, html, math, json
OUT = (os.environ.get("DOC_OUT") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))) + "/06-wireframes"
os.makedirs(OUT + "/wireframes", exist_ok=True)
F = "font-family='Helvetica,Arial,sans-serif'"
def esc(s): return html.escape(str(s))
class C:
    def __init__(s): s.o = []
    def rect(s, x, y, w, h, fill="#fff", stroke="#8a8a8a", rx=3, dash=None, sw=1):
        d = f" stroke-dasharray='{dash}'" if dash else ""
        s.o.append(f"<rect x='{x:.0f}' y='{y:.0f}' width='{w:.0f}' height='{h:.0f}' rx='{rx}' fill='{fill}' stroke='{stroke}' stroke-width='{sw}'{d}/>")
    def text(s, x, y, t, size=12, weight="normal", fill="#222", anchor="start"):
        s.o.append(f"<text x='{x:.0f}' y='{y:.0f}' {F} font-size='{size}' font-weight='{weight}' fill='{fill}' text-anchor='{anchor}'>{esc(t)}</text>")
    def line(s, x1, y1, x2, y2, stroke="#b5b5b5", dash=None):
        d = f" stroke-dasharray='{dash}'" if dash else ""
        s.o.append(f"<line x1='{x1:.0f}' y1='{y1:.0f}' x2='{x2:.0f}' y2='{y2:.0f}' stroke='{stroke}'{d}/>")
    def bars(s, x, y, w, n=2):  # placeholder text lines
        for i in range(n): s.rect(x, y + i * 9, w * (0.9 if i % 2 == 0 else 0.6), 5, fill="#d9d9d9", stroke="none", rx=2)
def trunc(t, w, size=12):
    m = max(3, int(w / (size * 0.56)))
    return t if len(t) <= m else t[:m - 1] + "…"
def wrap(t, w, size=11):
    m = max(8, int(w / (size * 0.54))); out = []; cur = ""
    for word in t.split():
        if len(cur) + len(word) + 1 > m and cur: out.append(cur); cur = word
        else: cur = (cur + " " + word).strip()
    if cur: out.append(cur)
    return out
def btn(c, x, y, label, primary=False, h=26):
    w = len(label) * 6.6 + 22
    c.rect(x, y, w, h, fill="#3a3a3a" if primary else "#fff", stroke="#3a3a3a", rx=4)
    c.text(x + w / 2, y + h / 2 + 4, label, 11, "bold" if primary else "normal", "#fff" if primary else "#222", "middle")
    return w
def draw(c, els, x, y, w, mobile=False):
    for e in els:
        k = e[0]
        if k == "title":
            c.text(x, y + 22, trunc(e[1], w - 10, 18), 18 if not mobile else 16, "bold")
            bx = x + w
            for i, b in enumerate(reversed(e[2] if len(e) > 2 else [])):
                bw = len(b.lstrip("*")) * 6.6 + 22; bx -= bw
                btn(c, bx, y + 4, b.lstrip("*"), b.startswith("*")); bx -= 8
            y += 44 if not (mobile and len(e) > 2 and e[2]) else 44
        elif k == "banner":
            ls = wrap("! " + e[1], w - 20); h = 14 + 14 * len(ls)
            c.rect(x, y, w, h, fill="#efefef", stroke="#555", dash="4 3")
            for i, l in enumerate(ls): c.text(x + 10, y + 18 + i * 14, l, 11)
            y += h + 8
        elif k == "text":
            for l in wrap(e[1], w, 12): c.text(x, y + 14, l, 12, fill="#444"); y += 16
            y += 8
        elif k == "cards":
            n = len(e[1]); per = 2 if mobile else n; rows = math.ceil(n / per); cw = (w - (per - 1) * 10) / per
            for i, l in enumerate(e[1]):
                cx = x + (i % per) * (cw + 10); cy = y + (i // per) * 74
                c.rect(cx, cy, cw, 66); lab, _, val = l.partition("|")
                c.text(cx + 10, cy + 20, trunc(lab, cw - 16, 11), 11, fill="#555"); c.text(cx + 10, cy + 46, trunc(val or "000.00", cw - 16, 18), 18, "bold")
            y += rows * 74 + 6
        elif k == "tabs":
            tx = x
            for i, t in enumerate(e[1]):
                tw = len(t) * 6.4 + 20; c.text(tx + 10, y + 18, t, 12, "bold" if i == 0 else "normal")
                if i == 0: c.line(tx, y + 26, tx + tw, y + 26, "#222")
                tx += tw
            c.line(x, y + 27, x + w, y + 27); y += 38
        elif k == "filters":
            fx = x
            for t in e[1]:
                fw = len(t) * 6.2 + 34
                if fx + fw > x + w: break
                c.rect(fx, y, fw, 26, rx=13); c.text(fx + 12, y + 17, t + " ▾", 11); fx += fw + 8
            y += 36
        elif k == "table":
            cols, rows = e[1], e[2]; cw = w / len(cols)
            c.rect(x, y, w, 28 * (rows + 1), stroke="#8a8a8a"); c.rect(x, y, w, 28, fill="#ececec", stroke="#8a8a8a")
            for i, h in enumerate(cols): c.text(x + i * cw + 8, y + 18, trunc(h, cw - 10, 11), 11, "bold")
            for r in range(rows):
                ry = y + 28 * (r + 1); c.line(x, ry, x + w, ry)
                for i in range(len(cols)): c.rect(x + i * cw + 8, ry + 11, cw * (0.55 if (i + r) % 2 else 0.4), 6, fill="#d4d4d4", stroke="none", rx=2)
            y += 28 * (rows + 1) + 10
        elif k == "form":
            per = 1 if mobile else 2; fw = (w - (per - 1) * 16) / per
            for i, f_ in enumerate(e[1]):
                fx = x + (i % per) * (fw + 16); fy = y + (i // per) * 50
                c.text(fx, fy + 12, trunc(f_, fw, 11), 11, fill="#444"); c.rect(fx, fy + 17, fw, 26)
            y += math.ceil(len(e[1]) / per) * 50 + 6
        elif k == "chart":
            h = e[2] if len(e) > 2 else 130; c.rect(x, y, w, h); c.text(x + 10, y + 18, trunc(e[1], w - 20, 11), 11, fill="#555")
            n = 8; bw = (w - 60) / n
            for i in range(n):
                bh = (h - 50) * (0.35 + 0.6 * abs(math.sin(i * 1.7 + len(e[1]))))
                c.rect(x + 30 + i * bw, y + h - 14 - bh, bw * 0.6, bh, fill="#cfcfcf", stroke="#8a8a8a", rx=1)
            c.line(x + 20, y + h - 14, x + w - 20, y + h - 14, "#555"); y += h + 10
        elif k == "cols":
            ratio = e[3] if len(e) > 3 else 0.5
            if mobile:
                y = draw(c, e[1], x, y, w, mobile); y = draw(c, e[2], x, y, w, mobile)
            else:
                lw = (w - 16) * ratio; y1 = draw(c, e[1], x, y, lw); y2 = draw(c, e[2], x + lw + 16, y, w - lw - 16); y = max(y1, y2)
        elif k == "tree":
            for t in e[1]:
                ind = (len(t) - len(t.lstrip(">"))); lab = t.lstrip(">")
                c.rect(x + ind * 22, y, min(w - ind * 22, 330), 26); c.text(x + ind * 22 + 10, y + 17, trunc(("▸ " if "+" in lab else "") + lab, 300, 11), 11)
                if ind: c.line(x + ind * 22 - 12, y + 13, x + ind * 22, y + 13); c.line(x + ind * 22 - 12, y - 6, x + ind * 22 - 12, y + 13)
                y += 32
            y += 6
        elif k == "steps":
            n = len(e[1]); sw_ = w / n
            for i, t in enumerate(e[1]):
                cx = x + i * sw_ + 12; act = i == e[2]
                c.o.append(f"<circle cx='{cx:.0f}' cy='{y+13:.0f}' r='10' fill='{'#3a3a3a' if act else '#fff'}' stroke='#3a3a3a'/>")
                c.text(cx, y + 17, str(i + 1), 10, "bold", "#fff" if act else "#222", "middle"); c.text(cx + 16, y + 17, trunc(t, sw_ - 34, 11), 11, "bold" if act else "normal")
                if i < n - 1: c.line(cx + sw_ - 26, y + 13, cx + sw_ - 14, y + 13, "#555")
            y += 38
        elif k == "bar":
            c.rect(x, y, w, 44, fill="#f4f4f4", stroke="#8a8a8a"); bx = x + w - 10
            for b in reversed(e[1]):
                bw = len(b.lstrip("*")) * 6.6 + 22; bx -= bw; btn(c, bx, y + 9, b.lstrip("*"), b.startswith("*")); bx -= 8
            if len(e) > 2: c.text(x + 10, y + 27, trunc(e[2], bx - x - 20, 11), 11, fill="#444")
            y += 54
        elif k == "list":
            for t in e[1]:
                lab, _, val = t.partition("|"); c.rect(x, y, w, 44)
                c.text(x + 12, y + 27, trunc(lab, w * 0.62, 12), 12); c.text(x + w - 12, y + 27, trunc(val, w * 0.34, 12), 12, "bold", anchor="end") if val else c.text(x + w - 14, y + 27, "›", 14, anchor="end")
                y += 48
            y += 4
        elif k == "box":
            ls = wrap(e[1], w - 20); h = max(e[2], 16 + 14 * len(ls))
            c.rect(x, y, w, h, dash="5 4")
            for i, l in enumerate(ls): c.text(x + 10, y + 18 + i * 14, l, 11, fill="#444")
            y += h + 10
        elif k == "big":
            c.text(x, y + 16, e[1], 12, fill="#555"); c.text(x, y + 50, e[2], 30, "bold"); y += 64
        elif k == "btns":
            bx = x
            for b in e[1]:
                if mobile:
                    p = b.startswith("*"); lab = b.lstrip("*")
                    c.rect(x, y, w, 40, fill="#3a3a3a" if p else "#fff", stroke="#3a3a3a", rx=6)
                    c.text(x + w / 2, y + 25, lab, 13, "bold", "#fff" if p else "#222", "middle"); y += 48
                else: bx += btn(c, bx, y, b.lstrip("*"), b.startswith("*")) + 8
            y += 0 if mobile else 38
    return y
def frame_desktop(sid, name, nav, active, els, area="Staff application"):
    c = C(); W = 1200; body = C(); yend = draw(body, els, 232, 68, W - 232 - 24)
    H = max(620, yend + 24)
    c.rect(0, 0, W, H, fill="#fff", stroke="#555", rx=0)
    c.rect(0, 0, W, 48, fill="#f1f1f1", stroke="#8a8a8a", rx=0)
    c.text(16, 30, "LOGO  ·  Tenant ▾  ·  Market ▾", 12, "bold"); c.rect(430, 11, 340, 26, rx=13); c.text(446, 29, "Search people, orders, cases…   /", 11, fill="#777")
    c.text(W - 16, 30, "🔔   Help   User ▾", 12, anchor="end")
    c.rect(0, 48, 208, H - 48, fill="#fafafa", stroke="#8a8a8a", rx=0)
    for i, n in enumerate(nav):
        if n == active: c.rect(8, 62 + i * 34, 192, 28, fill="#e2e2e2", stroke="#8a8a8a")
        c.text(22, 81 + i * 34, n, 12, "bold" if n == active else "normal")
    c.o += body.o
    c.text(W - 10, H - 8, f"{sid} · {name} · low-fidelity wireframe · {area}", 10, fill="#888", anchor="end")
    return W, H, c
def frame_portal(sid, name, active, els):
    c = C(); W = 1200; body = C(); yend = draw(body, els, 240, 76, 720); H = max(560, yend + 24)
    c.rect(0, 0, W, H, fill="#fff", stroke="#555", rx=0); c.rect(0, 0, W, 52, fill="#f1f1f1", stroke="#8a8a8a", rx=0)
    c.text(240, 32, "TENANT LOGO", 12, "bold")
    for i, n in enumerate(["Home", "Earnings", "Rank", "Customers", "Team", "More"]): c.text(420 + i * 90, 32, n, 12, "bold" if n == active else "normal")
    c.o += body.o; c.text(W - 10, H - 8, f"{sid} · {name} · low-fidelity wireframe · Distributor portal, desktop width", 10, fill="#888", anchor="end")
    return W, H, c
def frame_mobile(sid, name, active, els, nav=True):
    c = C(); W = 360; body = C(); yend = draw(body, els, 16, 60, W - 32, True); H = max(640, yend + (70 if nav else 20))
    c.rect(0, 0, W, H, fill="#fff", stroke="#555", rx=18, sw=2); c.rect(1, 1, W - 2, 48, fill="#f1f1f1", stroke="none", rx=17)
    c.text(16, 31, "‹", 18); c.text(W / 2, 31, trunc(name, 220, 13), 13, "bold", anchor="middle"); c.text(W - 16, 31, "🔔", 13, anchor="end"); c.line(0, 49, W, 49, "#8a8a8a")
    c.o += body.o
    if nav:
        c.line(0, H - 56, W, H - 56, "#8a8a8a")
        for i, n in enumerate(["Home", "Earnings", "Rank", "Customers", "More"]):
            cx = 36 + i * 72; c.rect(cx - 9, H - 46, 18, 18, fill="#444" if n == active else "#fff", stroke="#444", rx=4); c.text(cx, H - 14, n, 10, "bold" if n == active else "normal", anchor="middle")
    return W, H, c
def save(fn, W, H, c):
    open(f"{OUT}/wireframes/{fn}.svg", "w", encoding="utf-8").write(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {W} {H}' width='{W}' height='{H}' role='img'>" + "".join(c.o) + "</svg>")

NAV_B = ["Home", "Periods", "Plans", "People", "Orders", "Cases", "Payouts", "Finance", "Compliance", "Data", "Settings"]
NAV_A = ["Compliance", "Data", "Settings"]
NAV_V = ["Tenants", "Support sessions", "Provisioning", "Market packs", "Releases", "Audit"]
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "wf_screens.py"), encoding="utf-8").read())
index = {}
for sid, s in SCREENS.items():
    fr = s.get("frame", "desktop")
    if fr == "desktop": W, H, c = frame_desktop(sid, s["name"], s.get("nav", NAV_B), s["active"], s["els"], s.get("area", "Staff application"))
    elif fr == "portal": W, H, c = frame_portal(sid, s["name"], s["active"], s["els"])
    elif fr == "bare":
        c = C(); body = C(); yend = draw(body, s["els"], 400, 110, 400); W, H = 1200, max(560, yend + 30); c.rect(0, 0, W, H, fill="#fff", stroke="#555", rx=0); c.rect(360, 60, 480, yend - 40, stroke="#8a8a8a"); c.o += body.o
        c.text(W - 10, H - 8, f"{sid} · {s['name']} · low-fidelity wireframe", 10, fill="#888", anchor="end")
    save(sid, W, H, c); index[sid] = dict(name=s["name"], file=f"wireframes/{sid}.svg", group=s["group"], notes=s.get("notes", []))
    if "mobile" in s:
        m = s["mobile"]; W, H, c = frame_mobile(sid, m.get("name", s["name"]), m.get("active", s.get("active")), m["els"], m.get("nav", True))
        save(sid + "-mobile", W, H, c); index[sid]["mobile"] = f"wireframes/{sid}-mobile.svg"; index[sid]["mnotes"] = m.get("notes", [])
json.dump(index, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "wf_index.json"), "w"), indent=1)
print(len(index), "screens;", sum(1 for v in index.values() if "mobile" in v), "mobile variants")
