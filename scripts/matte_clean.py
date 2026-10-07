"""Raw BiRefNet alpha -> clean RGBA mattes in mattes/<clip>/fXXXXX.png.

Per frame: keep-region -> component filter -> solid core (close + small-hole fill) -> temporal median
(clamped to this frame's own core / support so nothing ghosts) -> 1px shrink + light feather ->
foreground colour estimation (removes pink bleed) -> edge-band despill -> optional white sticker stroke.
"""
# EDIT PER PROJECT: the region_* functions and CFG below are tuned for the APT. example
# (singer + bass drum, kneeling shot, two dancers, sticker heads). Rewrite them for your clips.

import sys
from pathlib import Path
import numpy as np
import cv2
from pymatting import estimate_foreground_ml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clips import CLIPS, ROOT

W, H = 1148, 720

# cv2.imread/imwrite can't open non-ASCII paths on Windows (the project folder is Chinese)
def imread(path, flags=cv2.IMREAD_COLOR):
    return cv2.imdecode(np.fromfile(str(path), np.uint8), flags)

def imwrite(path, img):
    ok, buf = cv2.imencode(Path(path).suffix, img)
    buf.tofile(str(path))

def disc(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

def lerp_keys(keys, f):
    """keys: sorted [(frame, value)], piecewise-linear."""
    fs = [k for k, _ in keys]; vs = [v for _, v in keys]
    return float(np.interp(f, fs, vs))

# ---------- per-clip keep regions (1 = may keep) ----------
def region_sit(f, shape):
    h, w = shape
    m = np.zeros(shape, np.uint8)
    # singer: everything left of x=545, minus the tilted crash cymbal next to her hair
    m[:, :545] = 1
    cv2.ellipse(m, (558, 132), (130, 70), 12.5, 0, 360, 0, -1)
    # bass drum head (slightly oversized so the model's own soft edge is used)
    cv2.ellipse(m, (772, 411), (230, 233), 0, 0, 360, 1, -1)
    return m

KNEEL_SPLIT = [(800, 0.555), (825, 0.53), (845, 0.505), (865, 0.48), (893, 0.48)]
def region_kneel(f, shape):
    h, w = shape
    m = np.zeros(shape, np.uint8)
    x = int(lerp_keys(KNEEL_SPLIT, f) * w)
    m[:, :x] = 1
    # in the wide part (from ~f855) cymbals sit above her head on the left of the kit
    if f >= 855:
        m[: int(0.30 * h), int(0.38 * w):] = 0
    return m

def region_all(f, shape):
    return np.ones(shape, np.uint8)

CFG = {
    "heads_a": dict(region=region_all, keep="largest", stroke=6),
    "heads_b": dict(region=region_all, keep="largest", stroke=6),
    "sit":     dict(region=region_sit, keep="big", lo=0.1),
    "sit2":    dict(region=region_sit, keep="big"),
    "kneel":   dict(region=region_kneel, keep="main", open=5, lo=0.2, band=5, spill=1.0),
    "dance":   dict(region=region_all, keep="two", lo=0.15, band=4, spill=0.9, global_spill=0.5),
}

def component_keep(b, mode):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(b, connectivity=8)
    if n <= 1:
        return b
    areas = stats[1:, cv2.CC_STAT_AREA]
    order = np.argsort(-areas) + 1
    big = areas.max()
    if mode == "largest":
        keep = [order[0]]
    elif mode == "two":
        keep = [i for i in order[:2] if stats[i, cv2.CC_STAT_AREA] > 0.2 * big]
    elif mode == "main":
        # the largest blob plus sizeable pieces near it (motion-blurred hands can detach)
        x, y, w_, h_ = stats[order[0], :4]
        pad = 12
        keep = [order[0]] + [i for i in order[1:] if stats[i, cv2.CC_STAT_AREA] > 0.07 * big and
                             x - pad < stats[i, 0] + stats[i, 2] / 2 < x + w_ + pad and
                             y - pad < stats[i, 1] + stats[i, 3] / 2 < y + h_ + pad]
    else:  # "big"
        keep = [i for i in order if stats[i, cv2.CC_STAT_AREA] > 0.03 * big]
    return np.isin(lab, keep).astype(np.uint8)

def fill_small_holes(b, max_area):
    inv = (1 - b).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    out = b.copy()
    hh, ww = b.shape
    for i in range(1, n):
        x, y, w_, h_, a = stats[i]
        touches_edge = x == 0 or y == 0 or x + w_ == ww or y + h_ == hh
        if not touches_edge and a <= max_area:
            out[lab == i] = 1
    return out

def stage_a(alpha, f, cfg):
    """Region + components + solid core. Returns (alpha, core, support)."""
    a = alpha * cfg["region"](f, alpha.shape)
    b = (a > 0.5).astype(np.uint8)
    if cfg.get("open"):
        # cut thin attachments (cymbal stands, cables) before choosing components, then restore real edges
        r = cfg["open"]
        kept = component_keep(cv2.morphologyEx(b, cv2.MORPH_OPEN, disc(r)), cfg["keep"])
        b = b & cv2.dilate(kept, disc(r + 2))
    b = component_keep(b, cfg["keep"])
    support = cv2.dilate(b, disc(4))
    a = a * support
    solid = cv2.morphologyEx(b, cv2.MORPH_CLOSE, disc(4))
    solid = fill_small_holes(solid, max_area=1500)
    core = cv2.erode(solid, disc(3))
    a = np.maximum(a, core.astype(np.float32))
    return a, core, support

def process(name):
    cfg = CFG[name]
    src_dir = ROOT / "clips" / name
    raw_dir = ROOT / "mattes" / name / "raw"
    out_dir = ROOT / "mattes" / name
    files = sorted(raw_dir.glob("f*.png"))
    fidx = [int(p.stem[1:]) for p in files]
    A, CORE, SUP = [], [], []
    for p, f in zip(files, fidx):
        a = imread(p, cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
        a, c, s = stage_a(a, f, cfg)
        A.append(a); CORE.append(c); SUP.append(s)

    for k, (p, f) in enumerate(zip(files, fidx)):
        # temporal median of 3, clamped to this frame's own core (=1) and support (else 0)
        lo, hi = max(0, k - 1), min(len(A) - 1, k + 1)
        med = np.median(np.stack([A[lo], A[k], A[hi]]), axis=0)
        a = np.where(CORE[k] > 0, 1.0, med) * SUP[k]
        # 1px shrink + light feather
        a = cv2.erode(a, np.ones((3, 3), np.uint8))
        a = cv2.GaussianBlur(a, (0, 0), 0.7)
        if cfg.get("lo"):
            # drop the faint, pink-tinted motion-blur haze; keeps the solid body untouched
            lo = cfg["lo"]
            a = (a - lo) / (1 - lo)
        a = np.clip(a, 0, 1)

        img = cv2.cvtColor(imread(src_dir / p.name), cv2.COLOR_BGR2RGB).astype(np.float64) / 255
        fg = img.copy()
        ys, xs = np.nonzero(a > 0.002)
        if len(ys):
            y0, y1 = max(0, ys.min() - 8), min(a.shape[0], ys.max() + 9)
            x0, x1 = max(0, xs.min() - 8), min(a.shape[1], xs.max() + 9)
            fg[y0:y1, x0:x1] = estimate_foreground_ml(img[y0:y1, x0:x1], a[y0:y1, x0:x1].astype(np.float64))
        fg = np.clip(fg, 0, 1)

        # despill the outer 3px of the subject: pull magenta excess (min(R,B) above G) toward neutral
        inside = (a > 0.5).astype(np.uint8)
        dist = cv2.distanceTransform(inside, cv2.DIST_L2, 3)
        band = ((a > 0.002) & (dist <= cfg.get("band", 3))).astype(np.float32)
        band = cv2.GaussianBlur(band, (0, 0), 1.0)[..., None]
        R, G, B = fg[..., 0], fg[..., 1], fg[..., 2]
        excess = np.clip(np.minimum(R, B) - G, 0, None)[..., None]
        k = cfg.get("spill", 0.7)
        neutral = fg - excess * np.array([k, 0.0, k])
        lum = (0.299 * R + 0.587 * G + 0.114 * B)[..., None]
        neutral = 0.75 * neutral + 0.25 * lum
        fg = fg * (1 - band) + neutral * band
        if cfg.get("global_spill"):
            # the whole subject is lit by the pink set: pull magenta excess toward neutral everywhere (hair turns blonde again)
            R, G, B = fg[..., 0], fg[..., 1], fg[..., 2]
            ex = np.clip(np.minimum(R, B) - G, 0, None)[..., None]
            fg = fg - ex * np.array([0.5, 0.0, 0.8]) * cfg["global_spill"]

        rgba = np.dstack([np.clip(fg, 0, 1), a])
        if cfg.get("stroke"):
            r = cfg["stroke"]
            shape = cv2.dilate((a > 0.5).astype(np.uint8), disc(r)).astype(np.float32)
            shape = cv2.GaussianBlur(shape, (0, 0), 0.8)
            # head over white sticker backing
            out_a = a + shape * (1 - a)
            out_rgb = (fg * a[..., None] + 1.0 * shape[..., None] * (1 - a[..., None])) / np.maximum(out_a, 1e-6)[..., None]
            rgba = np.dstack([np.clip(out_rgb, 0, 1), out_a])

        out = (rgba * 255 + 0.5).astype(np.uint8)
        imwrite(out_dir / p.name, cv2.cvtColor(out, cv2.COLOR_RGBA2BGRA))
    print(f"{name}: {len(files)} frames cleaned", flush=True)

if __name__ == "__main__":
    for n in (sys.argv[1:] or list(CFG)):
        process(n)
