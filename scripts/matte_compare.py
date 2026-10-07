"""Compare rembg models on a few frames -> analysis/matte_compare.jpg (raw alpha, no cleanup)."""
import sys, time
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from rembg import new_session, remove

ROOT = Path(__file__).resolve().parent.parent
MODELS = sys.argv[1].split(",") if len(sys.argv) > 1 else ["isnet-general-use", "u2net_human_seg", "birefnet-general"]
SAMPLES = ["heads_a/f00240.png", "heads_b/f00300.png", "sit/f00460.png", "kneel/f00840.png", "kneel/f00880.png", "dance/f01200.png"]
TW = 300
FONT = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)

def on_bg(rgba, color):
    bg = Image.new("RGBA", rgba.size, color)
    return Image.alpha_composite(bg, rgba).convert("RGB")

tiles = []
for m in MODELS:
    sess = new_session(m)
    col = []
    t0 = time.time()
    for s in SAMPLES:
        im = Image.open(ROOT / "clips" / s).convert("RGB")
        out = remove(im, session=sess)
        col.append(out)
    print(f"{m}: {(time.time() - t0) / len(SAMPLES):.2f}s/frame")
    tiles.append((m, col))

src = [Image.open(ROOT / "clips" / s).convert("RGB") for s in SAMPLES]
th = lambda im: round(TW * im.height / im.width)
H = sum(th(im) for im in src)
sheet = Image.new("RGB", (TW * (len(MODELS) + 1), H + 24), "#222")
d = ImageDraw.Draw(sheet)
for c, name in enumerate(["原图"] + MODELS):
    d.text((c * TW + 6, 2), name, font=FONT, fill="white")
y = 24
for r, im in enumerate(src):
    h = th(im)
    sheet.paste(im.resize((TW, h)), (0, y))
    for c, (_, col) in enumerate(tiles):
        sheet.paste(on_bg(col[r], (40, 40, 48, 255)).resize((TW, h)), ((c + 1) * TW, y))
    y += h
sheet.save(ROOT / "analysis" / "matte_compare.jpg", quality=88)
