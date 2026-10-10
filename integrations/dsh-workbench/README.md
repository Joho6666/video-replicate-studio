# DSH Desktop 视频工作台适配源码 · 0.7.0

这是供本机开发和安装的 DSH Desktop 适配层，不是市场投稿包，也不代表上游发布或安装后已接通所有外部服务。`replicate` 包提供复刻前的参考资料整理；同一构建也保留原有 `factory` 界面。

0.7.0 默认使用选择＋账号链接的一次点击流程：从该账号一页最多12条元数据中选4～6条（默认4条），串行完成抖音／Instagram视频研究，展示关键帧、候选切镜条、中文笔记、素材清单和完整分段英文提示词；看完后逐方案保留。新任务只在用户显式选择时复用已保存风格。原生对话、版本理解卡和最多2条的旧模式保留在高级入口。详见 [完整研究流程与边界](RESEARCH-WORKFLOW.md)。真实视频效果等待使用者的新样本验证。

保留功能：账号采集元数据、本机历史库、视频来源去重、拆解结果引用、外部分析导入、已看与收藏、标签备注、隐藏与回收站、人工复刻结果反馈，以及本机周复盘结果查看。默认入口点击“开始研究并生成方案”即按界面显示的范围运行采集与模思分析；其他模型页保留未来生成配置草稿。不会调用视频生成。未分析的元数据不会显示为分析完成，人工标记“成功”也不会变成已经核验的最佳实践。

## 构建和检查

使用 Node.js 22 或更新版本。首次运行需要安装开发依赖；测试全部使用合成账号、临时数据与模拟服务，不读取私人视频、不调用 TikHub 或模型。

```sh
npm install --ignore-scripts
npm run build
npm test
npm run check
mkdir -p dist
npm pack ./workbenches/replicate --pack-destination ./dist --ignore-scripts
```

构建输出为 `workbenches/replicate` 和 `workbenches/factory`。`npm run check` 检查 DSH manifest、`cordis.patch.yml`、服务端与客户端入口、语法和包根目录的数据排除。`npm run preview` 只启动独立界面预览，不能证明 DSH 已加载或后端可用。

本地安装遵循 [DSH 工作台开发规范](https://dshdesktop.com/workbench/docs/development.md)。如果本机已有可用的 `dsh` CLI，可安装生成的 tgz：

```sh
dsh plugin --profile web add --ignore-scripts /absolute/path/derek-video-replicate-workbench-0.7.0.tgz
```

DSH Desktop 自带 CLI 的位置随安装方式而异，不要把某台电脑的应用路径写死在共享脚本中。升级前备份现有包和业务数据；重启后检查「已安装的工作台」、左侧入口、历史资料和实际报告播放。卸载包不会删除数据。

## 数据位置必须在安装前确认

当前适配器默认使用当前系统用户的 `Documents/DSH-Workbenches/data`。这是现有本机适配器的默认值，不是对新用户目录的授权，也没有首次运行的文件夹选择界面。安装前先选择并确认是否沿用该目录；若使用另一个目录，需要统一修改 `src/preproduction-store.mjs` 的 `defaultDataRoot` 后重建，并给周复盘命令传入相同的 `--data-root`。

`createHistoryStore({root})` 本身不依赖固定 home 路径，上游 Studio 可以注入自己的数据根目录。持久化位置包括：

- `library/state.json`：采集批次、去重记录、编辑状态、反馈、导入报告与周复盘。
- `index.json` 和各安全运行目录中的 `report.json`、`samples.json`：已有本机报告的只读迁移来源。
- `style-library/`：已有风格草稿；历史中只保留引用摘要。
- `library/review-drafts/`：周复盘临时来源快照，仍属于私人业务数据。

状态更新使用进程内队列、跨进程文件锁和原子替换；损坏的状态文件会报错并保留原文件，不会自动清空。隐藏和回收站不会删除原视频或报告。恢复记录会保留其原有隐藏选择。报告所引用的记录被隐藏或移入回收站后，默认视图不会继续展开这些报告。

隐藏只是整理默认视图，不是密码保护或操作系统访问控制。关键帧与视频读取也会重新核验隐藏和回收站状态。视频短缓存过期后不自动下载，已保存关键帧与笔记仍可打开。

## 采集、去重和结果留存

普通读取先使用成功的本机缓存；无缓存会提示先进行采集。只有用户主动开始本次账号研究、刷新或确认高级流程的具体研究版本后才调用 TikHub。Instagram `reel`、`p`、`tv` 来源按保留大小写的 shortcode 去重；追踪参数不进入来源键。重复导入不会取消隐藏、复活回收站条目或覆盖用户名称、备注及反馈。

本机报告引用只有在服务端读取到对应报告、确认来源匹配后才加入；下载状态需要文件确实存在。浏览器导入的分析报告另存为 `imported-unverified`，不会冒充实测报告。旧 localStorage 保留作回退，但界面读取以服务端历史为准。

当前包可以展示已有本机拆解证据，并手动对已下载且已收录的本机视频调用模思分析。新的研究入口可在确认后解析新抖音／Instagram视频，并为测量临时缓存；行业热门榜、视频生成或成片效果核验仍未接通。


## 品牌专题与模思分析

资料库以品牌／专题为主入口，展开后是视频列表，再进入单条视频的原片、分析与整理页。专题使用引用关系，多个专题中的同一视频仍只有一条底层记录。创建、改名和移动专题不会复活隐藏或回收站记录；搜索、计数和拆解结果都按当前视图过滤。

分析前记录用户的关注点，例如“只参考开头与剪辑节奏，不参考文案”。原有单片分析从已收录报告定位本机原片；新研究服务从确认的抖音／Instagram来源解析受控 CDN 地址，不接受任意本机路径或媒体 URL。只读模型状态和历史结果不会调用供应商。

- 画面理解：`moss-vl-1.0`，`POST https://api.mosi.cn/v1/responses`，一次一个视频；账号研究为完整分镜预留输出上限8000 tokens，旧两条研究模式为2500 tokens。
- 语音转写：`moss-transcribe-diarize-pro`，`POST /v1/audio/transcriptions`，返回原语言转写及时间段。中文标题、摘要和标签由 VL 输出；转写原文保留。
- 密钥：macOS Keychain service `derek.dsh-workbenches.models.mosi`、account `analysis`。服务器读取，浏览器不会收到密钥。
- 精确时间信息来自已有本机测量；VL 的节奏解释明确属于模型推断。转写不等同音乐节拍或声音语义识别。
- 当前官方文档显示 VL 限时免费、Pro 转写 ¥2／小时；按供应商当日价格与账单结算。TTS 1.5 是配音版本，本分析链不启用。

旧单片分析状态保存在私有 `data/analysis/`，账号研究结果和持久关键帧在 `data/research-analysis/`，任务在 `data/research/`，限时媒体缓存在 `data/research-media-cache/`；分步留存 ASR、VL 状态、模型、用量和用户意图。只有明确确认才上传所选素材。记录级锁和已完成缓存阻止重复收费；失败不会自动重试或改用别家模型。已有结果与新意图不同会提示未重跑，不能拿旧结果冒充新分析。

中文显示名与原始标题分开；模型结果不能覆盖用户明确命名。视频里的字幕和转写作为不可信素材输入，不作为 Agent 指令。隐藏或移入回收站后，默认入口不能读取该视频的分析；进行中的请求会在下一阶段复查可见状态。

当前验证采用合成数据和模拟供应商；真实样本效果需在使用者明确给定新视频和分析意图后另测。抖音／Instagram链接 → 解析 → 测量 → 分析已串接并通过合成验证；签名 URL、真实模型画面质量和素材建议仍需用户新样本实测。其他平台可保存计划；采集适配尚未接通，不据此推断TikHub账号缺少权限。

官方接口：[模型](https://platform.mosi.cn/docs/getting-started/models/)、[视觉理解](https://platform.mosi.cn/docs/reference/responses/)、[转写](https://platform.mosi.cn/docs/reference/transcriptions/)。

## 人工反馈和周复盘

每次“成功／需改进／尚未尝试”的人工反馈有独立 `attemptId`。更正使用 `correctionOf` 和更正说明，保留旧项并标记被哪次反馈替代。成功反馈需要说明具体表现；即使填写结果链接，也仍标注人工报告、未经独立核验。证据字段支持公开链接或文字说明，不保存本机绝对路径。

安装包本身不创建调度器或后台定时任务。需要另外配置并明确启用本机调度，例如让 Codex 对话在每周一 09:00（Asia/Shanghai）执行：

```sh
node scripts/weekly-review.mjs prepare --data-root /chosen/private/data
```

`prepare` 固定使用前一个完整的北京时间周一 00:00 至周一 00:00，输出仅含未隐藏、未删除记录的本机来源快照，并打印路径、版本与数量。由已获授权的本机 Agent 阅读快照、形成带证据边界的 Markdown 后，再保存：

```sh
node scripts/weekly-review.mjs save --data-root /chosen/private/data --source /path/to/source.json --markdown /path/to/review.md
```

保存会校验快照版本和来源引用；期间资料变化就拒绝旧结果，必须重新读取。脚本本身没有网络或模型调用。若没有成片证据，复盘必须保留“待验证的候选做法”，不称为已验证最佳实践。首轮也可运行无模型的最近七天摘要：

```sh
node scripts/weekly-review.mjs preview --data-root /chosen/private/data
```

这类摘要记录为 `local-summary`，与 Agent 撰写的 `codex-weekly` 分开。调度器是否已启用及首次自动执行是否成功，需要在各自本机单独验证。

## 提交与隐私边界

本目录只应提交源码、文档和合成测试。`.gitignore` 排除构建包、依赖、数据、媒体、备份、环境文件和复盘草稿。生成的 DSH 包只包含入口代码及说明，不包含个人业务记录。

真实视频、抽帧、签名下载 URL、TikHub 原始响应、分析报告、周复盘、隐藏状态、模型配置和 API 密钥都不应提交到 GitHub。TikHub 和模型密钥由本机 Keychain 保存；测试不读写真实 Keychain。文档中的路径仅是占位示例，不包含开发者个人目录或真实账号样本。
