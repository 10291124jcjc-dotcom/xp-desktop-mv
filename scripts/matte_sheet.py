"""Checkpoint 2 sheet: 3 frames per clip, each on checkerboard and on dark grey -> analysis/matte_check.jpg"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clips import ROOT

CLIPS = sys.argv[1:] or ["heads_a", "heads_b", "sit", "sit2", "kneel", "dance"]
T = 300
FONT = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)

def checker(w, h, s=12):
    y, x = np.mgrid[0:h, 0:w]
    c = (((x // s) + (y // s)) % 2).astype(np.uint8)
    arr = np.where(c[..., None] == 1, 205, 245).astype(np.uint8).repeat(3, axis=2)
    return Image.fromarray(arr).convert("RGBA")

def fit(im):
    s = min(T / im.width, T / im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)

rows = []
for name in CLIPS:
    files = sorted(p for p in (ROOT / "mattes" / name).glob("f*.png"))
    if not files:
        continue
    picks = [files[len(files) // 6], files[len(files) // 2], files[len(files) * 5 // 6]]
    tiles = []
    for p in picks:
        im = Image.open(p).convert("RGBA")
        bbox = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox() or (0, 0, im.width, im.height)
        pad = 16
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad))
        im = fit(im.crop(bbox))
        for bg in (checker(im.width, im.height), Image.new("RGBA", im.size, (34, 34, 40, 255))):
            t = Image.new("RGB", (T, T), (20, 20, 24))
            comp = Image.alpha_composite(bg, im).convert("RGB")
            t.paste(comp, ((T - im.width) // 2, (T - im.height) // 2))
            ImageDraw.Draw(t).text((5, 3), f"{name} {p.stem}", font=FONT, fill=(255, 79, 160))
            tiles.append(t)
    rows.append(tiles)

sheet = Image.new("RGB", (T * 6, T * len(rows)), (20, 20, 24))
for r, tiles in enumerate(rows):
    for c, t in enumerate(tiles):
        sheet.paste(t, (c * T, r * T))
out = ROOT / "analysis" / ("matte_check.jpg" if len(sys.argv) <= 1 else f"matte_check_{'_'.join(CLIPS)}.jpg")
sheet.save(out, quality=90)
print(out)
