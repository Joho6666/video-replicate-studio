"""Capture the screenshots used by the in-app tutorial (#/guide).

Run with any Python that has Playwright (MediaCrawler's venv does):
  apps/media-crawler/.venv/Scripts/python.exe scripts/capture_tutorial.py --job <tutorial job id>
Uses the locally installed Chrome, light theme, reduced motion. Output: apps/studio/public/tutorial/*.png
"""
import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "studio" / "public" / "tutorial"
JOBS = ROOT / "apps" / "studio" / "data" / "jobs"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3300")
    ap.add_argument("--job", required=True, help="finished job that has model / product / style images")
    ap.add_argument("--link", default="https://v.douyin.com/pGtj0OxuHko/")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    assets = sorted((JOBS / args.job / "assets").glob("*"))
    by_role = {r: [str(p) for p in assets if p.name.startswith(r + "-")] for r in ("model", "product", "style")}

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1.5, reduced_motion="reduce", locale="zh-CN")
        ctx.add_init_script("localStorage.setItem('studio-theme','light'); localStorage.setItem('studio-ref','en');")
        page = ctx.new_page()

        def shot(name, locator=None, pad=0):
            target = page.locator(locator).first if locator else None
            if target:
                target.scroll_into_view_if_needed()
                page.wait_for_timeout(350)
                box = target.bounding_box()
                page.screenshot(path=str(OUT / f"{name}.png"), clip={"x": max(box["x"] - pad, 0), "y": max(box["y"] - pad, 0), "width": box["width"] + pad * 2, "height": box["height"] + pad * 2})
            else:
                page.screenshot(path=str(OUT / f"{name}.png"))
            print("saved", name)

        # 1 home + engines
        page.goto(args.base + "/#/")
        page.wait_for_timeout(1500)
        shot("01-home")
        shot("01b-nav", ".topnav", pad=10)

        # 2 paste link, pick a scenario
        page.fill("#link", f"8.99 复制打开抖音，看看【夜景清唱】的作品 {args.link} ")
        page.dispatch_event("#link", "input")
        page.click("[data-tpl=story]")
        page.wait_for_timeout(300)
        shot("02-link-template", "#slate", pad=12)

        # 3 drop images
        for role in ("model", "product", "style"):
            for f in by_role[role][:1]:
                page.set_input_files(f".picker[data-role={role}] input", f)
                page.wait_for_timeout(200)
        page.fill("#brief input[name=product]", "粉色泡泡袖连衣裙")
        page.fill("#brief input[name=notes]", "泡泡袖、蝴蝶结腰带、及膝长度")
        shot("03-pickers", "#brief", pad=12)

        # 4 results
        page.goto(args.base + f"/#/job/{args.job}")
        page.wait_for_timeout(2500)
        page.evaluate("window.scrollTo(0,0)")
        shot("04-job-top")
        shot("04b-rail", "#rail", pad=8)
        shot("05-film", "#film", pad=8)

        def tab(name):
            page.click(f"[data-tab={name}]")
            page.wait_for_timeout(700)

        tab("overview")
        shot("06-overview-goal", ".panel.goal", pad=8)
        if page.locator(".asset-notes").count():
            shot("06b-asset-notes", ".asset-notes", pad=8)
        shot("06c-hook", ".panel.hook", pad=8)
        tab("shots")
        shot("07-shot", ".shot", pad=8)
        tab("libtv")
        shot("08-libtv-toolbar", ".toolbar", pad=8)
        shot("08b-segment", ".segment", pad=8)
        tab("copy")
        shot("09-copy-titles", "#tabBody .grid2", pad=8)
        shot("09b-voiceover", ".vo", pad=8)
        tab("assets")
        shot("10-assets", ".pickers.big", pad=8)
        page.locator("#export").scroll_into_view_if_needed()
        shot("10b-export", "#export >> xpath=ancestor::div[contains(@class,'panel')]", pad=8)
        browser.close()


if __name__ == "__main__":
    main()
