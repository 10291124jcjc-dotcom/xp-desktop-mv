"""Contact sheet from rendered frames: one tile every --step seconds, timecode + bar.beat on each tile.

  python tools/contact.py --frames render/preview --start 0 --end 2.72 --step 0.25 --out analysis/review/ch01_r1.jpg
"""
import argparse, json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FPS = 30
BEATS = json.loads((ROOT / "analysis" / "beats.json").read_text(encoding="utf-8"))
FONT = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 15)

def beat_label(t):
    P = BEATS["period"]; b0 = BEATS["bar_starts"][0]
    q = (t - b0) / P + 0.01  # tolerance: a tile sampled exactly on a bar line must not read as the previous bar
    bar_ = math.floor(q / 4); beat = q - bar_ * 4
    on = abs(beat - round(beat)) * P < 0.034  # within one frame of a beat
    return f"小节{bar_} 拍{beat + 1:.1f}", on

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True)
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--step", type=float, default=0.25)
    ap.add_argument("--cols", type=int, default=8)
    ap.add_argument("--tile", type=int, default=320)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    d = ROOT / a.frames
    ext = "jpg" if list(d.glob("*.jpg")) else "png"
    times, t = [], a.start
    while t < a.end - 1e-6:
        times.append(t); t += a.step
    tw, th = a.tile, round(a.tile * 9 / 16)
    rows = math.ceil(len(times) / a.cols)
    sheet = Image.new("RGB", (a.cols * tw, rows * (th + 22)), (18, 18, 22))
    dr = ImageDraw.Draw(sheet)
    for i, t in enumerate(times):
        f = min(round(t * FPS), 1222)
        p = d / f"{f:05d}.{ext}"
        x, y = (i % a.cols) * tw, (i // a.cols) * (th + 22)
        if p.exists():
            sheet.paste(Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS), (x, y + 22))
        lab, on = beat_label(t)
        dr.text((x + 4, y + 2), f"{t:05.2f}s  {lab}", font=FONT, fill=(255, 79, 160) if on else (220, 220, 220))
    out = ROOT / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=88)
    print(out)

if __name__ == "__main__":
    main()
