# 复刻研究室 0.6.3

本机 DSH Desktop 适配层；不代表原生 Studio 或上游发布。当前只做复刻前研究，不生成视频。

## 一次任务

1. 输入抖音／Instagram 品牌主页或最多两条视频链接，写下产品、受众和参考重点；也可通过 macOS 系统听写输入文字。
2. 「让 Agent 理解」将内容放入 DSH 原生会话草稿，由用户发送。沿用已获准的宿主文本模型。MOSI VL 不支持纯文本需求理解。
3. Agent 用 Host tool 创建可编辑的理解卡。UI 确认绑定 `planId + planRevision + planHash`；改来源、意图、范围、模型政策或风格版本后必须重新确认。
4. 正式研究确认后，串行读取候选。可按最新／指定指标自动研究最多两条；也可先展示最多 8 条元数据候选，用户勾选 1～2 条再确认深拆。候选阶段不把标题或热度推断成画面风格。之后才解析媒体、测量、转写、视觉分析和归档。「只保存方案」为独立的 `planning-only` 模式，即使确认也不调用供应商。
5. 结果先给可复刻形式、保留/修改项、时间证据与具体素材要求，再展开中文笔记。每次研究和视频归入品牌／专题；风格需要用户另行确认，冻结版本后可在新任务显式复用。

素材未提供时不阻断研究，也不声称素材齐全。缺产品或受众信息时给条件性建议。参考字幕、转写和第三方文字只作为数据，不作为执行指令。

## 能力与边界

- DSH 原生 conversation、Session input、Host tools；没有第二套聊天、Pi Agent 或 Harness。
- 四个研究 Host tools 只能提案或读取。研究会话动态限制其他终端、文件、子 Agent、`run_code` 等工具，不能绕过 UI 确认。此边界不是同一系统用户进程的操作系统隔离。
- 供应商授权与工作台接入状态分别保存：沿用已有 TikHub Keychain 凭据，不逐平台重建密钥或收窄授权。未接通平台也可保存理解卡；仅规划确认不调用服务，正式采集则需对应适配器可用。
- TikHub：抖音／Instagram 单页最多 12 条候选，单片详情解析。`latest` 只按已知发布时间排序；数据优先必须有时间窗与指标。范围始终是已取得候选，不冒充全账号排行；缺时间或指标时保留缺口。
- 抖音来源接受 `www.douyin.com/user/<sec_user_id>` 与 `www.douyin.com/video/<aweme_id>`。分享短链在 UI 确认后以公开 HTTPS 跳转展开；不调用额外的付费短链服务。若只返回登录页面、JavaScript 跳转或非预期地址，则保留错误并提示完整链接。App V3 列表与详情以官方 OpenAPI 为依据，内层响应和实际 CDN 兼容仍需新样本验收；失败不自动换 Web 接口。
- MOSI：`moss-vl-1.0` 视觉分析、`moss-transcribe-diarize-pro` 人声转写。TTS 1.5 属于配音，不进入本链路。
- 视频直链与公开页面地址分开；不要求用户手动下载。供应商可读的有效 CDN URL 直接用于 VL；ASR 与机器切镜测量使用后台临时 MP4 缓存。
- 缓存限制：每条 200 MiB、600 秒；总量 512 MiB、24 小时有效期，仅清理工作台创建的缓存。只允许预期 CDN、公共地址、固定解析 IP、受控 MP4 容器；不读取任意本机路径或跟随重定向。
- 机器切点、叙事段落、VL 推断、人声转写分别保存。ASR 不代表音乐理解或 BPM 测量。模型建议和用户采用都不等于复刻成效已验证。
- TikTok 研究、自动行业发现、长期抓取、视频生成与成片验证尚未接通。现有历史、隐藏、回收站、反馈和本机周复盘保留。

## 幂等、恢复与保存

跨进程锁和原子写入维护版本、任务和请求状态。重复确认同一版本返回同一任务；读取结果不调用供应商。失败保留成功步骤和部分结果；没有静默重试、供应商回退或重新付费。重启后中断任务不会自动重发；修改运行中的计划会停止旧版本尚未发起的步骤，已送达供应商的请求可能已经计费。

默认使用安装前已确认的 `Documents/DSH-Workbenches/data`，可由服务工厂注入其他根目录。`library/state.json` 保留原历史，`research/state.json` 保存理解卡、任务与风格版本，`research-analysis/` 保存阶段响应；所有这些都是私有业务数据。历史中的新研究结果可直接在视频分析页读取。

隐藏/回收站贯穿研究、视频详情、风格证据和后台刷新。隐藏是视图整理，不是密码保护。回收站不删除原始素材。旧归档、本机原片和人工命名不被新失败结果覆盖。

密钥只由服务端读取 macOS Keychain，不进浏览器、源码、日志或 tgz。共享仓库只包含源码、合成测试和通用说明；不提交真实素材、分析、偏好、私人课程或本机配置。

## 费用口径

理解卡固定调用上限与价格快照，不把旧短视频估价套给新任务。2026-10-10 官方文档参考：Instagram 的 TikHub 接口每次 US$0.008；账号两条研究最多三次请求，估算 US$0.024。抖音 App V3 接口的官方 OpenAPI 未标单价，卡片明确费用待核验；最多三次调用，不套用 Instagram 单价。Pro ASR ¥2/小时，两条各 600 秒上限约 ¥0.667。VL 当时限时免费，价格变化以平台实际账单为准，不能承诺无限期免费或总金额保证。宿主文字模型另按配置计费。

## 构建与安装

Node.js 22+。开发依赖使用 `npm install --ignore-scripts`，然后：

```sh
npm run build
npm test
npm run check
mkdir -p dist
npm pack ./workbenches/replicate --pack-destination ./dist --ignore-scripts
dsh plugin --profile web add --ignore-scripts /absolute/path/derek-video-replicate-workbench-0.6.3.tgz
```

构建还保留 factory 包输出；本轮只更新 replicate 安装。按 [DSH 开发规范](https://dshdesktop.com/workbench/docs/development.md) 从 tgz 安装并重启，核对已安装列表、侧栏及真实业务操作。仅预览页面或修改配置不能证明安装成功。升级前备份代码、已安装包和受影响状态，回退时恢复对应包；不要用旧状态覆盖升级后新增的业务数据。

## 验证范围

合成测试覆盖：确认前零调用、版本失效、跨进程重复确认、串行上限、未知指标、部分失败、中断恢复、隐藏过滤、风格冻结、会话归属、工具权限、媒体限制与 UI 操作。它们不证明真实模型分析质量。

本机原生文本会话已实际调用 Host tool 并自动显示理解卡；视频端真实测试应等待用户新提供的链接及想法。不得使用旧样本替代，不得把模拟服务成功标成真实采集或分析效果已验证。系统听写、签名媒体 URL 的真实可读性、模型建议是否有用，分别验证与记录。

官方参考：[TikHub API](https://api.tikhub.io/)、[MOSI 模型](https://platform.mosi.cn/docs/getting-started/models/)、[视觉](https://platform.mosi.cn/docs/reference/responses/)、[转写](https://platform.mosi.cn/docs/reference/transcriptions/)。
