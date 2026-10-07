"""Render engine frames with headless Edge (Playwright, local browser, no download).

  python tools/render.py --script shots/ch01.json,shots/ch02.json --start 0 --end 7.3 --out render/ch12 --scale 0.5
  python tools/render.py --script shots/_stills.json --times 0.5,1.5 --out analysis/stills --names boot,desktop
Frame i of a range render is t = i/30 (global frame index), so files line up with the source timeline.
"""
import argparse, functools, http.server, math, socketserver, sys, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FPS = 30

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", required=True)
    ap.add_argument("--start", type=float)
    ap.add_argument("--end", type=float)
    ap.add_argument("--times")
    ap.add_argument("--names")
    ap.add_argument("--out", required=True)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--fmt", default="png", choices=["png", "jpeg"])
    a = ap.parse_args()

    if a.times:
        times = [float(x) for x in a.times.split(",")]
        names = a.names.split(",") if a.names else [f"t{t:06.3f}" for t in times]
        jobs = list(zip(times, names))
    else:
        f0, f1 = math.ceil(a.start * FPS - 1e-6), math.ceil(a.end * FPS - 1e-6)
        jobs = [(f / FPS, f"{f:05d}") for f in range(f0, f1)]

    out = ROOT / a.out
    out.mkdir(parents=True, exist_ok=True)
    srv = serve()
    port = srv.server_address[1]
    W, H = round(1920 * a.scale), round(1080 * a.scale)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        page.on("console", lambda m: m.type in ("error", "warning") and print("[page]", m.text, file=sys.stderr))
        page.on("pageerror", lambda e: print("[pageerror]", e, file=sys.stderr))
        page.goto(f"http://127.0.0.1:{port}/engine/index.html?script={a.script}&scale={a.scale}")
        page.wait_for_function("window.Pinkdows && (window.Pinkdows.ready === true || window.Pinkdows.error)", timeout=60000)
        err = page.evaluate("window.Pinkdows.error || null")
        if err:
            sys.exit(f"engine init failed: {err}")
        t0 = time.time()
        for i, (t, name) in enumerate(jobs):
            page.evaluate(f"Pinkdows.render({t!r})")
            page.screenshot(path=str(out / f"{name}.{'jpg' if a.fmt == 'jpeg' else 'png'}"),
                            clip={"x": 0, "y": 0, "width": W, "height": H}, type=a.fmt,
                            **({"quality": 92} if a.fmt == "jpeg" else {}))
            if i and i % 60 == 0:
                print(f"  {i}/{len(jobs)} frames, {(time.time() - t0) / i:.3f}s/frame", flush=True)
        browser.close()
    srv.shutdown()
    print(f"rendered {len(jobs)} frames -> {out}")

if __name__ == "__main__":
    main()
