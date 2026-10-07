"""analysis/grid.jpg: one frame per second, timecode + shot index + bar/beat, crop box drawn on bordered shots."""
import json, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
shots = json.loads((ROOT / "analysis" / "shots.json").read_text(encoding="utf-8"))
beats = json.loads((ROOT / "analysis" / "beats.json").read_text(encoding="utf-8"))
W, H = 1148, 720
TW = 330; TH = round(TW * H / W)
COLS = 7
FONT = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 17)
SMALL = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 13)

def grab(t):
    # accurate seek (-ss after -i) so the tile really shows time t
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(ROOT / "source.mp4"), "-ss", f"{t:.3f}", "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(H, W, 3)
frames = [grab(float(t)) for t in range(int(beats["duration"]) + 1)]

def beat_label(t):
    bs = [b for b in beats["beats"] if b["t"] <= t + 1e-6]
    if not bs or bs[-1]["bar"] < 0:
        return "前奏"
    b = bs[-1]
    return f"小节{b['bar'] + 1} 拍{b['bar_pos'] + 1}"

n = len(frames)
rows = -(-n // COLS)
sheet = Image.new("RGB", (COLS * TW, rows * TH), "#111")
for i, f in enumerate(frames):
    t = float(i)
    k = next(j for j, s in enumerate(shots) if s["start"] <= t < s["end"] or j == len(shots) - 1)
    s = shots[k]
    im = Image.fromarray(f).resize((TW, TH), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    if s["bordered"]:
        w, h, x, y = s["crop"]
        sx = TW / W
        d.rectangle([x * sx, y * sx, (x + w) * sx - 1, (y + h) * sx - 1], outline="#33ff88", width=2)
    label = f"{int(t):02d}s · 镜头{k + 1}"
    d.rectangle([0, 0, 150, 24], fill=(0, 0, 0, 180))
    d.text((5, 1), label, font=FONT, fill="white")
    sub = beat_label(t) + ("  有黑边" if s["bordered"] else "")
    d.rectangle([0, TH - 20, 160, TH], fill=(0, 0, 0))
    d.text((5, TH - 19), sub, font=SMALL, fill="#ffc0dc")
    sheet.paste(im, ((i % COLS) * TW, (i // COLS) * TH))
sheet.save(ROOT / "analysis" / "grid.jpg", quality=88)
print("grid:", sheet.size, "frames:", n)
