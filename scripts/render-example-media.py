#!/usr/bin/env python3
"""Renders the ILLUSTRATIVE InvoicePilot example media for the public campaign page (PRD v1.4 R1).

ASSUMPTION A1: the example app is the existing fictional InvoicePilot sample.
ASSUMPTION A2: there is no real footage yet, so every frame here is a rendered illustration,
burned in with an "Illustrative example" label. Replace with real, permissioned footage before
calling the example a complete campaign.

Outputs to public/example/: source-demo.mp4 + .vtt, clip-<id>.mp4 + .vtt (8 clips), poster.jpg,
pack.zip. Requires ffmpeg with drawtext. Run: python3 scripts/render-example-media.py
"""
import json, os, subprocess, zipfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "example")
DATA = json.load(open(os.path.join(ROOT, "content", "example-campaign.json")))
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def esc(t):
    return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\u2019").replace(",", "\\,")

def wrap(t, n):
    words, lines, cur = t.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > n: lines.append(cur); cur = w
        else: cur = (cur + " " + w).strip()
    if cur: lines.append(cur)
    return lines

def ts(s):
    return f"{int(s//3600):02d}:{int(s%3600//60):02d}:{s%60:06.3f}"

def render(name, scenes, w, h):
    """scenes: [{title, body, caption, seconds}] -> mp4 with burned label + sidecar VTT captions."""
    filters, t, vtt = [], 0.0, ["WEBVTT", ""]
    tsize, bsize, wrapn = (52, 34, 46) if w > h else (54, 36, 26)
    for i, sc in enumerate(scenes):
        a, b = t, t + sc["seconds"]
        en = f"enable='between(t,{a},{b})'"
        y = int(h * 0.22)
        filters.append(f"drawtext=expansion=none:fontfile={BOLD}:text='{esc(sc['title'])}':fontcolor=white:fontsize={tsize}:x=(w-text_w)/2:y={y}:{en}")
        for j, line in enumerate(wrap(sc["body"], wrapn)):
            filters.append(f"drawtext=expansion=none:fontfile={FONT}:text='{esc(line)}':fontcolor=0xC7D2FE:fontsize={bsize}:x=(w-text_w)/2:y={y + tsize + 40 + j*(bsize+14)}:{en}")
        vtt += [str(i + 1), f"{ts(a)} --> {ts(b)}", sc["caption"], ""]
        t = b
    # progress bar + persistent labels
    filters.append(f"drawbox=x=0:y=ih-12:w=iw*t/{t}:h=12:color=0x818CF8:t=fill")
    filters.append(f"drawtext=expansion=none:fontfile={BOLD}:text='ILLUSTRATIVE EXAMPLE':fontcolor=0xFDE68A:fontsize=26:x=30:y=30:box=1:boxcolor=0x00000088:boxborderw=10")
    filters.append(f"drawtext=expansion=none:fontfile={FONT}:text='InvoicePilot (fictional sample) · AppDemo.live':fontcolor=0xE2E8F0:fontsize=22:x=30:y=h-60")
    mp4 = os.path.join(OUT, f"{name}.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=0x1E1B4B:s={w}x{h}:d={t}:r=24",
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono", "-t", str(t),
        "-vf", ",".join(filters), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "30", "-preset", "veryfast",
        "-c:a", "aac", "-b:a", "32k", "-shortest", "-movflags", "+faststart", mp4], check=True)
    open(os.path.join(OUT, f"{name}.vtt"), "w").write("\n".join(vtt))
    return mp4, t

os.makedirs(OUT, exist_ok=True)
src, _ = render("source-demo", DATA["source"]["scenes"], 1280, 720)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "1.5", "-i", src, "-frames:v", "1", "-q:v", "4", os.path.join(OUT, "poster.jpg")], check=True)
for c in DATA["clips"]:
    render(f"clip-{c['id']}", c["scenes"], 720, 1280)
with zipfile.ZipFile(os.path.join(OUT, "invoicepilot-example-pack.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("README.txt", "ILLUSTRATIVE EXAMPLE - InvoicePilot is a fictional sample app. These files are rendered illustrations, not real customer work or footage.\n")
    for f in sorted(os.listdir(OUT)):
        if f.startswith("clip-") or f.startswith("source-demo"): z.write(os.path.join(OUT, f), f)
    z.writestr("post-copy.json", json.dumps(DATA["posts"], indent=2))
print("rendered", sorted(os.listdir(OUT)))
