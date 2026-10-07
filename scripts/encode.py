"""Mux rendered frames with the untouched source audio.

  python tools/encode.py --frames render/preview --out out/APT_XP_draft_480p.mp4 --height 480 --crf 23
  python tools/encode.py --frames render/final --out out/APT_XP_v1.mp4 --crf 16
"""
import argparse, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--crf", type=int, default=16)
    ap.add_argument("--height", type=int)
    a = ap.parse_args()
    d = ROOT / a.frames
    ext = "jpg" if list(d.glob("*.jpg")) else "png"
    vf = ["format=yuv420p"]
    if a.height:
        vf.insert(0, f"scale=-2:{a.height}:flags=lanczos")
    out = ROOT / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", str(d / f"%05d.{ext}"),
           "-i", str(ROOT / "source.mp4"), "-map", "0:v", "-map", "1:a",
           "-vf", ",".join(vf), "-c:v", "libx264", "-preset", "slow", "-crf", str(a.crf),
           "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)
    print(out)

if __name__ == "__main__":
    main()
