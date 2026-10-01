# video-replicate-studio

爆款视频复刻的素材侧 monorepo（pnpm workspace）。

| 目录 | 内容 | 语言 |
| :--- | :--- | :--- |
| `apps/media-crawler` | [NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) 源码快照（上游 `380b426`，2026-09-19） | Python（uv）+ docs（vitepress） |
| `apps/studio` | **复刻 Studio**：粘贴链接 → 抓取 → 切镜 → AI 导演拆解 → LibTV 分段提示词与素材包（零依赖 Node） | Node + 原生 HTML/CSS/JS |
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

## 复刻 Studio（演示界面）

```bash
cp apps/studio/.env.example apps/studio/.env.local   # 填 DeepSeek / TikHub Key，或用 AVD_ENV_FILE 指向已有配置
pnpm studio                                          # http://127.0.0.1:3300
```

- 抖音 / B站：MediaCrawler（首次弹出 Chrome 扫码，登录态保存在 `apps/media-crawler/browser_data/`）；抖音失败且配了 TikHub 时自动改用 TikHub。
- TikTok / Instagram：TikHub（需 `TIKHUB_API_KEY`）。
- 任务数据在 `apps/studio/data/jobs/<id>/`，导出的素材包在其中的 `export/`。
- 导演拆解：场景检测找切点 → 每个镜头截「首 / 中 / 尾」三联图 → DeepSeek 先做全片拆解、再逐段（≤15s）写提示词，记录动作过程与结束状态；三联图里看出的漏检切点用 SSIM 二分定位到帧。
- 「H3 出片」：把逐镜描述编译成 MiniMax H3 三段式提示词（素材包里的 `H3提示词.md`）。配了 `MINIMAX_API_KEY`（按量付费 Key）后可在页面上一键生成：先确认费用，同一段只提交一次（生成中或结果不明时不会重提），出片后自动下载并生成「原片 | 生成」左右对照视频，记录在任务的 `h3/seg-N/`。
- 声音（MOSI，配 `MOSS_API_KEY` 后启用）：拆解时自动转写原片口播 / 对白并交给导演和文案；「带货文案」页可按每段时长一键配音（`expected_duration_sec` 实测误差约 0.05s）；「H3 出片」页在所有段出片后可合成完整成片（配音在上、H3 原声压低作底），附 `captions.srt` 字幕。
- 测试：`cd apps/studio && npm test`（纯函数，不调用任何付费接口）。
