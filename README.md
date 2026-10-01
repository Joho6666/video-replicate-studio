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

## 镜头表与分镜板（脚本出片 + 复刻共用）

所有入口（参考视频复刻、脚本出片、手工编辑）都产出同一张**镜头表**（`board.json`）：每个镜头标明画面来源 —— `reuse` 复用素材 / `still` 分镜图 / `generate` 付费生成 / `client` 客户提供 —— 以及预估费用。

- **脚本出片**：首页「用脚本出片」→ 粘贴脚本（带时间码或不带）→ AI 拆镜头，系统决定哪些镜头值得付费生成（只给口播钩子，且受生成秒数上限约束）；涉及专家 / 医生形象的镜头一律标为「客户提供」，不用 AI 编造。
- **复刻任务**：拆解完成后，在「分镜板」标签页一键从导演结果生成镜头表。
- **分镜板**：改台词与提示词、切换来源、审批、设预算上限；「生成缺失分镜图」用 MiniMax image-01 逐张生成（先确认张数，已有的不重复生成）；「出动态分镜」用本地 ffmpeg 免费拼出带字幕的预览视频。
- 费用只由服务端按 `lib/board.mjs` 的单价表重算，页面数字仅用于展示；同一次付费调用内的镜头按一次计费（如一段 H3）。
- 本轮不含：统一的付费生成后端（H3 仍在「H3 出片」页提交）、镜头级质检、批量队列。

测试：`cd apps/studio && npm test`（含镜头表校验与计价、脚本拆镜、分镜图生成防重复、动态分镜真实渲染）。
