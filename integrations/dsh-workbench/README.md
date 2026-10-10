# DSH Desktop 视频工作台适配源码 · 0.4.3

这是供本机开发和安装的 DSH Desktop 适配层，不是市场投稿包，也不代表上游发布或安装后已接通所有外部服务。`replicate` 包提供复刻前的参考资料整理；同一构建也保留原有 `factory` 界面。

当前功能：账号采集元数据、本机历史库、视频来源去重、拆解结果引用、外部分析导入、已看与收藏、标签备注、隐藏与回收站、人工复刻结果反馈，以及本机周复盘结果查看。模型页只保存未来接入配置；不会调用视频生成。未分析的元数据不会显示为分析完成，人工标记“成功”也不会变成已经核验的最佳实践。

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
dsh plugin --profile web add --ignore-scripts /absolute/path/derek-video-replicate-workbench-0.4.3.tgz
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

隐藏只是整理默认视图，不是密码保护或操作系统访问控制。

## 采集、去重和结果留存

普通读取先使用成功的本机缓存；无缓存会提示先进行采集。只有用户主动刷新并确认后才调用 TikHub。Instagram `reel`、`p`、`tv` 来源按保留大小写的 shortcode 去重；追踪参数不进入来源键。重复导入不会取消隐藏、复活回收站条目或覆盖用户名称、备注及反馈。

本机报告引用只有在服务端读取到对应报告、确认来源匹配后才加入；下载状态需要文件确实存在。浏览器导入的分析报告另存为 `imported-unverified`，不会冒充实测报告。旧 localStorage 保留作回退，但界面读取以服务端历史为准。

当前包可以展示已有本机拆解证据。它不会自动下载新视频、运行新视频的视觉分析、抓取行业热门榜、生成视频或核验成片效果。

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
