# 账号对标与本机历史资料库

关联需求： https://github.com/Joho6666/video-replicate-studio/issues/1

从导航「账号对标」或「历史资料库」进入。这里管理复刻之前的采集、参考报告和人工反馈；不改动 Studio 既有视频生产 pipeline，也不会从历史页启动生成。

## 日常使用

1. 保存 Instagram 品牌主页和使用目标。主页与单条 Reel 分开校验。
2. 「读取本机记录」复用服务端缓存，不调用 TikHub。首次使用没有缓存时会明确提示；需要新数据时主动点击刷新、确认一次可能收费的请求。
3. 刷新最多读取一个列表页、保留 12 条视频元数据，成功后自动归档。失败不覆盖已有记录，不自动翻页、下载或调用分析模型。
4. 在历史资料库按账号、标题、备注或标签查找。可以标记已看、收藏、修改标题及备注，查看已有报告。
5. 隐藏条目进入「已隐藏」，回收条目进入「回收站」，都可以恢复。恢复保留原来的隐藏状态；隐藏只是视图整理，不是密码保护。此版本不提供物理删除原视频或清空回收站。
6. 复刻完成后，可登记自评成功、还需改进或尚未尝试，补充说明与成片证据。记录的是用户反馈；点击成功不等于平台独立验证了效果。

重复链接按规范化的来源地址去重；重新抓取不会清除已看、收藏、隐藏、回收、备注等整理状态。账号页面的旧浏览器记录可以迁移，已有服务端状态优先，旧记录不会把隐藏视频重新展示出来。

## 报告和风格草稿

- 服务端 `data/benchmark/` 保留历史、批次和报告引用，重启后继续使用。报告按 `runId` 读取，不依赖当前账号索引被覆盖后的状态。
- 兼容本机预处理产物：`index.json` 的 `accounts` 将账号指向运行目录；目录中 `report.json`、`samples.json` 和受限相对路径的视频/抽帧作为本地证据。首次访问会只读迁移旧报告到资料库索引，不搬移原素材。
- 「已有分析结果？导入报告」接收外部 Agent 的结构化结果，验证后保存为 `imported-unverified`。报告必须引用至少两条不同视频，输出 1–2 个类型；格式通过不代表应用已经看过视频或验证账号归属。
- 本机报告可显示原片、镜头候选区间、画面观察、字幕及音频说明、素材要求。报告包含什么证据取决于实际运行；不拿元数据或热度冒充视觉分析。
- 收藏风格生成 `draft-unconfirmed` 快照，保留来源报告和规则，不自动采用、更改或执行复刻。
- 隐藏或回收被引用视频后，默认报告和缓存不再展示受限引用；含这类引用的外部报告及复盘会提示不可用，恢复后再查看。

本仓库没有附带真实视频、品牌分析、历史记录、模型配置或凭据，也没有提供自动运行的品牌采集脚本。

## 本地周复盘

可以由本机 Codex 定时读取资料库，在用户确认的时间生成周复盘；例如每周一 09:00（Asia/Shanghai）。**调度属于用户本机配置，不随仓库安装、不由服务器自行启用。**

复盘只读取未隐藏、未回收的记录和本周人工反馈，不重新抓取、不调用生成模型、不上传业务数据。输出应区分：有成片证据的反馈、仅用户自评的成功、待验证候选，以及失败/修正原因。没有可核验效果时写明「本周暂无已验证最佳实践」，不能把点赞或用户点击成功当作独立效果验证。复盘保存原始记录 ID、反馈 ID、时间范围和来源 revision，方便追溯；历史视图里可以再次打开。

`createHistoryStore({root})` 暴露 `exportReviewSource`、`saveReview` 和 `readReview`，便于本地调度器复用。不会因为导入代码就创建定时任务或接通模型。

## 本机存储与 API

目录相对 Studio 为 `apps/studio/data/benchmark/`，已加入 `.gitignore`。核心状态使用原子替换和写入锁；损坏数据会停止写入并保留原文件，不静默重置。无真实内容提交到 GitHub。

| 路径 | 方法 | 用途 |
|---|---|---|
| `/api/benchmark/samples` | POST | 默认读缓存；仅 `refresh:true, consent:true` 才调用一次 TikHub |
| `/api/benchmark/history?view=active&q=` | GET | 活跃、已隐藏或回收站记录、批次及复盘索引 |
| `/api/benchmark/history` | POST | 标记、编辑、隐藏、回收、恢复或登记反馈 |
| `/api/benchmark/history/import-legacy` | POST | 迁移旧浏览器账号/报告记录 |
| `/api/benchmark/history/review?id=` | GET | 读取已保存的本机复盘 |
| `/api/benchmark/history/imported-report?id=` | GET | 读取未独立核验的导入报告 |
| `/api/benchmark/preproduction/report` | GET | 按账号或运行 ID 读取本机拆解报告 |
| `/api/benchmark/preproduction/evidence` | GET | 读取白名单相对路径的本机视频或图片，支持 Range |
| `/api/benchmark/preproduction/style` | POST | 收藏为未确认风格草稿 |

写入需要 `x-studio: 1`，跨站来源被拒绝。服务端复用项目已有 TikHub 配置；客户端不接收密钥。仅允许官方 TikHub HTTPS 地址，不通过重定向转发凭据。媒体证据采用路径白名单及真实路径约束，不提供任意本机文件读取接口。

## 外部报告格式

以下均是合成示例，不属于真实账号：

```json
{
  "schemaVersion": 1,
  "accountUrl": "https://www.instagram.com/examplebrand/",
  "source": "分析器名称 / 版本",
  "analyzedAt": "2026-10-10T00:00:00Z",
  "types": [{
    "type": "视频类型",
    "tone": "依据样本观察的调性",
    "rhythm": "依据镜头时间的节奏",
    "hook": "开头做什么",
    "subtitles": "字幕观察，未知写未知",
    "reason": "结合目标的推荐理由",
    "editPlan": "混剪建议",
    "replicaPlan": "复刻建议",
    "requiredAssets": ["所需画面，库存尚待核对"],
    "evidence": [
      {"url":"https://www.instagram.com/reel/EXAMPLE_A/","start":0,"end":3,"observation":"应填写真实画面观察"},
      {"url":"https://www.instagram.com/reel/EXAMPLE_B/","start":2,"end":5,"observation":"应填写真实画面观察"}
    ]
  }]
}
```

## 验证范围

本次代码验证使用临时目录与合成样本，覆盖去重、重启后读取、隐藏和回收恢复、旧报告迁移、外部报告保存、人工反馈与复盘证据界限、缓存不产生请求、明确刷新单次调用、失败不覆盖以及文件访问限制。没有用真实凭据调用 TikHub，也没有付费模型或视频生成。

运行相关检查：

```sh
node --test apps/studio/test/account-benchmark.test.mjs apps/studio/test/benchmark-history.test.mjs apps/studio/test/benchmark-preproduction.test.mjs
node --check apps/studio/server.mjs
```

浏览器视觉验收与真实第三方接口验证是独立验证项目；测试通过不等于这两项已经完成。
