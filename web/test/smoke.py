"""CI smoke test: serve build/web, load it in headless Chromium, require the boot log and no page errors."""
import os, subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parents[2]
site = root / "build" / "web"
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8790", "--bind", "127.0.0.1", "-d", str(site)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
logs, errors = [], []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for i, vp in enumerate(({"width": 1440, "height": 900}, {"width": 390, "height": 844})):
            page = b.new_page(viewport=vp)
            page.on("console", lambda m: logs.append(m.text))
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto("http://127.0.0.1:8790/index.html", wait_until="load")
            deadline = time.time() + 120
            while time.time() < deadline and sum("VFB Fly Explorer (web)" in l for l in logs) < i + 1 and not errors:
                time.sleep(0.5)
            page.close()
        b.close()
finally:
    srv.terminate()
boot = [l for l in logs if "VFB Fly Explorer (web)" in l]
print("\n".join(boot))
if errors:
    print("PAGE ERRORS:\n" + "\n".join(errors)); sys.exit(1)
if len(boot) < 2:
    print("app did not boot at both viewports"); sys.exit(1)
if "placeholder body" in boot[0]:
    print("WARNING: placeholder body (fly_body.glb missing)")
print("smoke ok")
