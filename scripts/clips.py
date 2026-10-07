"""Clip definitions shared by extraction, matting and the engine.

Frames are named by their GLOBAL 30fps index (f = round(t*30)) so any tool can map time -> file directly.
"""
# EDIT PER PROJECT: CLIPS below are the APT. example's source ranges - list your own clips to cut out.

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FPS = 30
SHOTS = json.loads((ROOT / "analysis" / "shots.json").read_text(encoding="utf-8"))

def crop_at(t):
    for s in SHOTS:
        if s["start"] <= t < s["end"]:
            return s["crop"]
    return SHOTS[-1]["crop"]

# name: (start_s, end_s, needs_matte)
CLIPS = {
    "heads_a": (7.337, 8.940, True),    # Rosé head on black bolts (bordered)
    "heads_b": (8.940, 12.062, True),   # white-outlined sticker heads
    "sit":     (14.000, 16.537, True),  # sitting by the bass drum
    "sit2":    (25.537, 26.605, True),  # same setup, before the chorus
    "kneel":   (26.605, 29.827, True),  # kneeling / falling
    "dance":   (39.428, 40.774, True),  # two dancers, full body
}

def frame_range(start, end):
    """Global 30fps frame indices fully inside [start, end): skip the first frame after a cut (may straddle it)."""
    import math
    return list(range(math.ceil(start * FPS) + 1, math.floor(end * FPS)))

if __name__ == "__main__":
    import subprocess
    for name, (a, b, _) in CLIPS.items():
        out = ROOT / "clips" / name
        out.mkdir(parents=True, exist_ok=True)
        frames = frame_range(a, b)
        w, h, x, y = crop_at((a + b) / 2)
        f0, f1 = frames[0], frames[-1]
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(ROOT / "source.mp4"),
                        "-vf", f"fps={FPS},trim=start_frame={f0}:end_frame={f1 + 1},setpts=PTS-STARTPTS,crop={w}:{h}:{x}:{y}",
                        "-start_number", str(f0), str(out / "f%05d.png")], check=True)
        n = len(list(out.glob("f*.png")))
        print(f"{name:8s} {a:6.3f}-{b:6.3f}s  frames {f0}-{f1} ({n} files)  crop {w}x{h}+{x}+{y}")
