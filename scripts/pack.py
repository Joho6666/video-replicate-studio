"""Build a self-contained, ready-to-run zip of 复刻 Studio *including the user's API keys*.

Usage: python scripts/pack.py [--avd <ai-video-director repo>] [--out <zip path>]
The keys are copied file-to-file and never printed.
"""
import argparse
import datetime as dt
import os
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# ai-video-director checkout that holds .env.local and ffmpeg-static (pass --avd or set AVD_REPO)
DEFAULT_AVD = os.environ.get("AVD_REPO", "")

SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".pnpm-store", "browser_data", ".cache", ".fxref"}
SKIP_FILES = {".env.local"}  # studio .env.local is rewritten below
STORE_EXT = {".mp4", ".mov", ".jpg", ".jpeg", ".png", ".webp", ".zip", ".gz"}


def skip(rel: Path) -> bool:
    parts = rel.parts
    if any(p in SKIP_DIRS or p.endswith("_user_data_dir") for p in parts):
        return True
    # MediaCrawler's raw crawl output duplicates source/video.mp4 inside each job
    if len(parts) >= 5 and parts[:3] == ("apps", "studio", "data") and parts[4] == "crawl":
        return True
    if parts[:3] == ("apps", "media-crawler", "data"):
        return True
    return rel.name in SKIP_FILES or rel.suffix in {".pyc", ".tmp"}


def studio_env() -> str:
    src = ROOT / "apps" / "studio" / ".env.local"
    lines = src.read_text(encoding="utf-8").splitlines() if src.exists() else []
    drop = re.compile(r"^\s*(AVD_ENV_FILE|FFMPEG_PATH|FFPROBE_PATH)\s*=")
    kept = [l for l in lines if not drop.match(l)]
    kept.insert(0, "# 打包生成：密钥文件与 FFmpeg 都用包内相对路径")
    kept.insert(1, "AVD_ENV_FILE=../../config/ai-video-director.env.local")
    return "\n".join(kept) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--avd", default=str(DEFAULT_AVD))
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
    ap.add_argument("--out", default=str(ROOT.parent / f"复刻Studio-开箱即用-含密钥-{stamp}.zip"))
    args = ap.parse_args()
    if not args.avd:
        raise SystemExit("pass --avd <ai-video-director repo> or set AVD_REPO")
    avd = Path(args.avd)
    extras = {
        "config/ai-video-director.env.local": avd / ".env.local",
        "tools/ffmpeg/ffmpeg.exe": avd / "node_modules" / "ffmpeg-static" / "ffmpeg.exe",
        "tools/ffmpeg/ffprobe.exe": avd / "node_modules" / "ffprobe-static" / "bin" / "win32" / "x64" / "ffprobe.exe",
    }
    missing = [k for k, v in extras.items() if not v.exists()]
    if missing:
        raise SystemExit(f"missing inputs: {missing}")

    top = "复刻Studio"
    count = 0
    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            rel_dir = Path(dirpath).relative_to(ROOT)
            dirnames[:] = [d for d in dirnames if not skip(rel_dir / d)]
            for name in filenames:
                rel = rel_dir / name
                if skip(rel):
                    continue
                full = Path(dirpath) / name
                if full.resolve() == Path(args.out).resolve():
                    continue
                method = zipfile.ZIP_STORED if full.suffix.lower() in STORE_EXT else zipfile.ZIP_DEFLATED
                z.write(full, f"{top}/{rel.as_posix()}", compress_type=method)
                count += 1
        z.writestr(f"{top}/apps/studio/.env.local", studio_env())
        for arc, src in extras.items():
            z.write(src, f"{top}/{arc}", compress_type=zipfile.ZIP_DEFLATED)
            count += 1
    size = Path(args.out).stat().st_size / 1048576
    print(f"{args.out}\n{count + 1} files, {size:.1f} MB")


if __name__ == "__main__":
    main()
