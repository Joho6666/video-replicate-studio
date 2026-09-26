# video-replicate-studio

爆款视频复刻的素材侧 monorepo（pnpm workspace）。

| 目录 | 内容 | 语言 |
| :--- | :--- | :--- |
| `apps/media-crawler` | [NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) 源码快照（上游 `380b426`，2026-09-19） | Python（uv）+ docs（vitepress） |
| `apps/media-crawler/webui` | MediaCrawler 自带 WebUI（`mediacrawler-webui`） | React + Vite |

> ⚠️ **许可证**：MediaCrawler 使用 *NON-COMMERCIAL LEARNING LICENSE 1.1* —— 仅限学习研究，
> **未经作者书面同意不得用于商业用途**，也不得大规模抓取。用于电商带货视频生产前，请先取得授权
> 或改用商用接口（如 ai-video-director 已接入的 TikHub）。

## 安装（C 盘空间不足，缓存全部放 D 盘）

```bash
# Python 依赖（Python 3.11）
UV_CACHE_DIR=D:/uv-cache UV_PYTHON_INSTALL_DIR=D:/uv-python pnpm crawler:setup
# 前端依赖（WebUI + docs）
pnpm install --store-dir D:/pnpm-store
```

默认 `ENABLE_CDP_MODE=True`：复用本机已装的 Chrome，不需要 `playwright install` 下载浏览器。

## 用法：按链接抓单条参考视频（复刻最常用）

```bash
cd apps/media-crawler
uv run main.py --platform dy --lt qrcode --type detail \
  --specified_id "https://v.douyin.com/xxxx/" --get_media yes --get_comment no
```

首次会打开 Chrome 让你扫码登录，登录态保存在本地 `*_user_data_dir`（已 gitignore）。
平台：`dy` 抖音 · `xhs` 小红书 · `ks` 快手 · `bili` B站 · `wb` 微博。
视频与 `jsonl` 元数据落在 `apps/media-crawler/data/`（已 gitignore）。

WebUI：`pnpm crawler:api`（:8080）+ `pnpm dev:webui`（:5173）。

## 在复刻流水线中的位置

```
抓取（本仓库）→ 转录口播/字幕 → 提示词工作台（Video 1 / Image N 映射）→ LibTV / Wan 3.0 生成 → Hypit 拼接包装
```
