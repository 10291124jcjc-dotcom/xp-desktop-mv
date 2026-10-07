"""Run BiRefNet on every clip frame, save raw alpha (8-bit gray) to mattes/<clip>/raw/. Cleanup is a separate step."""
import sys, time
from pathlib import Path
import onnxruntime as ort
ort.preload_dlls()
from rembg import new_session, remove
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clips import CLIPS, ROOT

sess = new_session("birefnet-general", providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
names = sys.argv[1:] or [n for n, c in CLIPS.items() if c[2]]
for name in names:
    src = sorted((ROOT / "clips" / name).glob("f*.png"))
    out = ROOT / "mattes" / name / "raw"
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    for p in src:
        dst = out / p.name
        if dst.exists():
            continue
        mask = remove(Image.open(p).convert("RGB"), session=sess, only_mask=True)
        mask.save(dst)
    print(f"{name}: {len(src)} frames, {time.time() - t0:.0f}s", flush=True)
