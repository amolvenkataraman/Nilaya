"""Screenshot pages of the local instance in light and dark, desktop and phone.

    .venv/bin/python localdev/screens.py / /calendar/ /accounts/login/ ...
    .venv/bin/python localdev/screens.py --quick /calendar/     (light + desktop only)
    (needs: uv pip install --python .venv playwright && .venv/bin/playwright install chromium)

Writes PNGs to localdev/data/screens/<page>-<theme>-<width>.png. Logs in as amol
unless the path is a public page (login, register).
"""

import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000"
OUT = Path(__file__).resolve().parent / "data" / "screens"
PUBLIC = ("/accounts/login/", "/accounts/register/")
SIZES = {"desktop": (1366, 850), "phone": (390, 844)}


def main(paths, themes=("light", "dark"), sizes=SIZES):
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in themes:
            for size, (w, h) in sizes.items():
                for public in (True, False):
                    batch = [x for x in paths if (x in PUBLIC) == public]
                    if not batch:
                        continue
                    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme)
                    page = ctx.new_page()
                    page.on("pageerror", lambda e, s=size, t=theme: errors.append(f"[{t}/{s}] JS error: {e}"))
                    if not public:
                        page.goto(BASE + "/accounts/login/")
                        page.fill("input[name=username]", "amol")
                        page.fill("input[name=password]", "localdev")
                        page.click("button[type=submit]")
                        page.wait_for_load_state("networkidle")
                    for path in batch:
                        page.goto(BASE + path)
                        page.wait_for_load_state("networkidle")
                        page.wait_for_timeout(300)
                        name = re.sub(r"[^a-z0-9]+", "-", path.strip("/").lower()) or "home"
                        file = OUT / f"{name}-{theme}-{size}.png"
                        page.screenshot(path=str(file), full_page=False)
                        print(file.relative_to(OUT.parent.parent))
                    ctx.close()
        browser.close()
    for e in errors:
        print(e)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] in ("--quick", "--quick-dark"):  # one theme, desktop only
        theme = "dark" if args[0] == "--quick-dark" else "light"
        main(args[1:] or ["/"], themes=(theme,), sizes={"desktop": SIZES["desktop"]})
    else:
        main(args or ["/"])
