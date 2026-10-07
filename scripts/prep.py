"""Stage-1 prep: scene cuts -> analysis/scenes.txt, loudness -> analysis/rms.json, all source frames -> clips/src/.

Run after beats.py (it extracts analysis/audio.wav) and before shots.py / grid.py.
"""
import json, re, subprocess
from pathlib import Path
import numpy as np
import librosa

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source.mp4"
(ROOT / "analysis").mkdir(exist_ok=True)

# scene cuts (threshold 0.3), in the metadata=print format shots.py reads
r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(SRC), "-vf", "select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")
cuts = [float(x) for x in re.findall(r"pts_time:([\d.]+)", r.stderr)]
(ROOT / "analysis" / "scenes.txt").write_text("".join(f"frame:{i} pts:0 pts_time:{t}\n" for i, t in enumerate(cuts)), encoding="utf-8")
print("cuts:", [round(c, 3) for c in cuts])

# per-frame loudness (normalised to the 98th percentile) for CPU graphs / voice meters
y, sr = librosa.load(ROOT / "analysis" / "audio.wav", sr=22050)
rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=sr // 30, center=True)[0]
rms = rms / np.percentile(rms, 98)
json.dump({"fps": 30, "rms": [round(float(min(v, 1.2)), 3) for v in rms]}, open(ROOT / "analysis" / "rms.json", "w"))

# every source frame at 30fps, numbered from 0 (frame f = time f/30) - the engine plays windows from these
out = ROOT / "clips" / "src"
out.mkdir(parents=True, exist_ok=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(SRC), "-vf", "fps=30", "-q:v", "2", "-start_number", "0",
                str(out / "f%05d.jpg")], check=True)
print("source frames:", len(list(out.glob("f*.jpg"))))
