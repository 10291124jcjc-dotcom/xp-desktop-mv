"""Per-shot black-border detection (ffmpeg cropdetect) -> analysis/shots.json."""
import json, re, subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source.mp4"
W, H, DUR = 1148, 720, 40.774

scenes = [float(l.split("pts_time:")[1]) for l in (ROOT / "analysis" / "scenes.txt").read_text().splitlines()
          if "pts_time:" in l]
bounds = [0.0] + scenes + [DUR]

shots = []
for a, b in zip(bounds, bounds[1:]):
    # sample the middle of the shot, skipping 2 frames at each edge
    ss, t = a + 0.05, max(0.05, b - a - 0.1)
    r = subprocess.run(["ffmpeg", "-hide_banner", "-ss", f"{ss:.3f}", "-t", f"{t:.3f}", "-i", str(SRC),
                        "-vf", "cropdetect=limit=44:round=2:reset=1", "-an", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    crops = re.findall(r"crop=(\d+):(\d+):(\d+):(\d+)", r.stderr)
    if crops:
        # per-frame boxes; median of each edge ignores frames where white handwriting spills over the border
        import numpy as np
        c = np.array(crops, dtype=int)
        left = np.median(c[:, 2]); top = np.median(c[:, 3])
        right = np.median(c[:, 2] + c[:, 0]); bottom = np.median(c[:, 3] + c[:, 1])
        x, y = int(left) // 2 * 2, int(top) // 2 * 2
        w, h = (int(right) - x) // 2 * 2, (int(bottom) - y) // 2 * 2
    else:
        w, h, x, y = W, H, 0, 0
    bordered = (W - w) > 8 or (H - h) > 8
    if not bordered:
        w, h, x, y = W, H, 0, 0
    shots.append({"start": round(a, 3), "end": round(b, 3), "crop": [w, h, x, y], "bordered": bordered})
    print(f"{a:6.3f}-{b:6.3f}  crop={w}x{h}+{x}+{y}  {'BORDER' if bordered else ''}")

(ROOT / "analysis" / "shots.json").write_text(json.dumps(shots, indent=1), encoding="utf-8")

