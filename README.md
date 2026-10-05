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
- 一键回归：`cd apps/studio && npm run smoke`（约 3 分钟，全程免费、不联网）。用合成素材把「镜头表 → 镜头质检 → 钩子变体（假写手 + 假配音）→ 导出 → factory 批量渲染 → 成片检查」整条链跑一遍，任何一步不对就非零退出；`-- --no-render` 跳过 factory 渲染（16 秒），`-- --keep` 保留临时目录。结果写在 `apps/studio/data/smoke/last.json`。

测试：`cd apps/studio && npm test`（纯函数，不调用任何付费接口）。

## 镜头表与分镜板（脚本出片 + 复刻共用）

所有入口（参考视频复刻、脚本出片、手工编辑）都产出同一张**镜头表**（`board.json`）：每个镜头标明画面来源 —— `reuse` 复用素材 / `still` 分镜图 / `generate` 付费生成 / `client` 客户提供 —— 以及预估费用。

- **脚本出片**：首页「用脚本出片」→ 粘贴脚本（带时间码或不带）→ AI 拆镜头，系统决定哪些镜头值得付费生成（只给口播钩子，且受生成秒数上限约束）；涉及专家 / 医生形象的镜头一律标为「客户提供」，不用 AI 编造。
- **复刻任务**：拆解完成后，在「分镜板」标签页一键从导演结果生成镜头表。
- **分镜板**：改台词与提示词、切换来源、审批、设预算上限；「生成缺失分镜图」用 MiniMax image-01 逐张生成（先确认张数，已有的不重复生成）；「出动态分镜」用本地 ffmpeg 免费拼出带字幕的预览视频。
- 费用只由服务端按 `lib/board.mjs` 的单价表重算，页面数字仅用于展示；同一次付费调用内的镜头按一次计费（如一段 H3）。
- 本轮不含：统一的付费生成后端（H3 仍在「H3 出片」页提交）、批量队列。

### 从镜头表提交付费生成（H3）

分镜板「提交付费生成」：先免费预览"要提交几次、每次几秒、多少钱"，确认后才提交。

- 服务端按镜头表重新计算（同一 `generate.group` 算一次调用，H3 最短 4 秒、¥0.5/秒），页面确认的次数和总价必须一致，否则 409；超过镜头表预算或上限 `GENERATE_MAX_CNY`（默认 ¥10）直接拒绝；一次最多 6 次。
- **先记账再发请求**（`shot.generate.task`）：崩溃或没拿到响应只会变成 `unknown`，之后只会提示去 MiniMax 控制台核对，**绝不自动重提交**；被拒（4xx 没扣费）才允许再试。账本只由服务端写，客户端改不了。
- 后台轮询，完成后自动下载并把视频接到对应镜头（多镜头共用一次生成时按各自起点取窗口）；重启服务会恢复轮询。新片段出来后旧的质检结果作废。
- 只接入 H3；Wan 等其他 provider 会显示"还没有接入"。`source.lipsync: false` 表示这是不说话的 b-roll，钩子变体可以给它换台词。

### 镜头质检

分镜板「镜头质检」对每个有视频片段的镜头出 PASS / WARN / FAIL：

- **免费客观检查（ffmpeg）决定硬失败**：能否解码、是否竖屏、片段够不够长、黑屏、静止帧、台词镜头是否静音。
- **视觉模型只能"举证"**：每镜 1 次 DeepSeek 视觉调用（几分钱），问题必须引用具体帧号和一句证据，没有证据的结论会被丢弃；high → FAIL，medium → WARN。
- 判定由服务端计算，页面传来的 qc 一律忽略；FAIL 的镜头标为 failed，页面提示"只重跑这几镜预计 ¥X"。**质检本身不提交任何付费生成**，重跑仍在「H3 出片」页逐段确认。
- 镜头的视频来自 `source.clip`（显式指定）/ 复用素材 / 已完成的 H3 段（按镜头在段内的位置取窗口）。
- **分镜图也会检查**：静态镜头按一张图送视觉模型，另有客观检查（能否解码、是否竖屏、是否整片空白）；新增问题类型「多出不该有的物体」（比如杯子画面里冒出手机）。重新生成一张图会清掉旧结果。注意：图像模型对"不要手机"这类否定句会适得其反，提示词里只写想要的，不要点名不想要的。

### 整段配音（脚本任务一键配音）

分镜板「整段配音」：每个有台词的镜头由 MOSI 配一句（时长贴合该镜头），再按镜头起点混成 `voice/full.wav`（动画预览和导出到批量剪辑都读它）。

- 先免费预览"要配几句、约多少字"，确认后才计费；服务端要求回传的句数和字数与它算的一致。用镜头表里选定的音色。
- 已经配好且文字、音色没变的句子不会重复计费；改了哪句只重配哪句；失败的句子不会自动重试，下次只剩它待配。
- 配音比镜头长会在混音时截断并给出警告。进度记在 `voice/manifest.json`（只由服务端写）。

### 导出到批量剪辑（short-video-factory）

分镜板「导出到批量剪辑」把镜头表导成一个**全新的** factory 项目目录（默认 `<仓库上级>/factory-projects/ai_<任务号>`，可用环境变量 `FACTORY_EXPORT_DIR` 改；只接受目录名，永远不写进已有项目，也不碰客户数据）：

- 每个可用镜头 → `素材索引.json` 一条（标记 `AI生成`）+ 60fps 竖屏预览；分镜图自动转成静态镜头；QC 为 FAIL、没有台词、没过合规检查（极限词 / 不在白名单的数字）、客户素材未提供的镜头会被跳过并写进 `导出报告.md`。
- 若任务里有 `voice/full.wav`，按镜头时间切片成每句配音；没有则剪辑端会用自带的中文语音。
- 生成 N 个变体脚本（`脚本/bNNN.json`）：同一份文案和镜头，变化的是转场、取景起点和配乐；想要不同的开头，用下面的「钩子变体」。
- 然后在 factory 里用 `run_batch.py` 渲染、`qc.py` 质检（命令写在导出报告里）。已用 Metaburn 的 16 个镜头实测：3 条 70 秒成片 6 分钟渲完（并行 2）。
- 实测限制：factory 把连续硬切的镜头用 `-c copy` 拼成一段，这一段超过约 10 秒就会渲染报错（8 秒内正常），所以导出时每段硬切不超过 8 秒（`MAX_CUT_RUN`）；另外太长的无标点句子会让它卡死，导出时已提前切开。

### 钩子变体（让批量剪辑的变体真的不一样）

分镜板「钩子变体」：DeepSeek 为开头第一句写 N 条备选（每条标明角度），**代码**决定哪些能用 —— 念完不能超过钩子位时长、数字只能来自 brief、命中极限词 / 广告法词 / 专家形象 / 和原钩子或彼此太像的都会被过滤并显示原因。

- 「生成钩子配音」用 MOSI 逐条配音（先确认条数和字数，按字计费，用镜头表里选定的同一个音色）；已配好的不重做；改了文字配音自动作废；配音文件只由服务端写入。
- 导出时每条有配音的钩子成为一个变体 `h01…`：钩子 + **非口播画面**（口型绑定原台词的口播镜头不能换台词，所以只留在原版 `b` 变体里）+ 原镜头表其余镜头。画面不够长时自动拆成多张。没配音 / 没有合适画面的钩子写进导出报告。
- 钩子只是开头一句话的 A/B；变体之间其余镜头仍然相同。哪条钩子更好只能靠投放数据，不保证哪条会爆。

测试：`cd apps/studio && npm test`（含镜头表校验与计价、脚本拆镜、分镜图生成防重复、动态分镜真实渲染、镜头质检与导出契约）。
