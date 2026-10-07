"""Final self-check: durations, A/V sync via cuts-vs-beats, and out/contact_sheet.jpg (one frame per second)."""
import json, re, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out" / "APT_XP_v1.mp4"
BEATS = json.loads((ROOT / "analysis" / "beats.json").read_text(encoding="utf-8"))

def probe(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate,duration,nb_frames:format=duration",
                        "-of", "json", str(p)], capture_output=True, text=True, encoding="utf-8")
    return json.loads(r.stdout)

src, out = probe(ROOT / "source.mp4"), probe(OUT)
print("source duration", src["format"]["duration"], "| output duration", out["format"]["duration"])
for s in out["streams"]:
    print("  output", s["codec_type"], s.get("width", ""), s.get("height", ""), s.get("r_frame_rate", ""), "dur", s.get("duration"))

# audio identity: decode both tracks and compare
def pcm(p):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-vn", "-ac", "1", "-ar", "22050", "-f", "f32le", "-"], capture_output=True)
    return np.frombuffer(r.stdout, np.float32)
a, b = pcm(ROOT / "source.mp4"), pcm(OUT)
n = min(len(a), len(b))
lag = int(np.argmax(np.correlate(a[22050:22050 * 3], b[22050 - 200:22050 * 3 + 200], mode="valid"))) - 200
print(f"audio: {len(a) / 22050:.3f}s vs {len(b) / 22050:.3f}s, lag {lag} samples ({lag / 22.05:.2f} ms), "
      f"corr {np.corrcoef(a[:n], b[:n])[0, 1]:.4f}")

# our hard cuts in the output vs the beat grid
r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(OUT), "-vf", "select='gt(scene,0.35)',showinfo", "-an", "-f", "null", "-"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")
cuts = [float(x) for x in re.findall(r"pts_time:([\d.]+)", r.stderr)]
grid = np.array([x["t"] for x in BEATS["beats"]])
half = np.sort(np.r_[grid, grid[:-1] + BEATS["period"] / 2])
print(f"{len(cuts)} cuts detected in output; offset to nearest beat/half-beat (ms):")
offs = []
for c in cuts:
    o = (c - half[np.argmin(np.abs(half - c))]) * 1000
    offs.append(o)
    print(f"  {c:7.3f}s  {o:+6.1f}")
offs = np.abs(np.array(offs))
print(f"  within one frame (33 ms): {(offs <= 34).sum()}/{len(offs)}")

# contact sheet: one frame per second with timecode
font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 18)
dur = float(out["format"]["duration"])
tiles = []
for t in range(int(dur) + 1):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(OUT), "-ss", f"{min(t, dur - 0.04):.3f}", "-frames:v", "1",
                          "-vf", "scale=384:216", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    im = Image.fromarray(np.frombuffer(raw, np.uint8).reshape(216, 384, 3))
    ImageDraw.Draw(im).rectangle([0, 0, 52, 24], fill=(0, 0, 0))
    ImageDraw.Draw(im).text((5, 1), f"{t:02d}s", font=font, fill=(255, 79, 160))
    tiles.append(im)
cols = 7
sheet = Image.new("RGB", (cols * 384, -(-len(tiles) // cols) * 216), (18, 18, 22))
for i, im in enumerate(tiles):
    sheet.paste(im, ((i % cols) * 384, (i // cols) * 216))
sheet.save(ROOT / "out" / "contact_sheet.jpg", quality=90)
print("contact sheet:", ROOT / "out" / "contact_sheet.jpg")
