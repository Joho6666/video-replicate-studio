# Instagram 账号对标（第一阶段）

关联需求： https://github.com/Joho6666/video-replicate-studio/issues/1

从导航「账号对标」进入。账号主页与单条 Reel 分开处理；普通新建拆解接口遇到账号主页会明确要求切换入口。

## 已实现

- 严格校验 Instagram HTTPS 域名、账号路径、单视频路径，移除追踪参数。
- 保存账号、目标产品/受众与现有素材说明；切换账号前保留 previous 本地记录。
- POST /api/benchmark/samples 使用项目已有的服务端 config.tikhub.key。每次一页最多 12 条；必须 consent:true；前端会先确认一次读取及可能的费用。不会自动翻页或调用分析/生成。
- 复用 TikHub Instagram V3 get_user_reels。文档：https://docs.tikhub.io/419083063e0 。仅允许官方 HTTPS 域名；禁止重定向转发凭据。过滤照片、重复视频和明确不属于目标账号的条目。
- 缺失指标保留 null，采集失败/未知响应结构不会伪装成空账号。记录视频 URL、采集时间、时间与指标；标记 metadata-only。
- 外部分析报告校验后展示 1–2 个不同类型，引用至少两条不同视频及时间段，展示调性、节奏、开头、字幕、推荐理由、素材要求和两种制作建议。统一标记 imported-unverified，不声称本应用已看过或验证视频归属。
- 将建议导出成混剪/复刻草稿；不自动创建执行任务或付费生成。

## 尚待后续实现

自动读取视频画面/音频、复用导演拆解结果、账号级类型聚类与自动推荐、用户素材自动匹配、稳定服务端任务/报告持久化、推荐直达现有镜头表执行链。当前代码是第一阶段入口与数据流，不是完整的账号自动分析功能。

本轮没有使用真实 TikHub 凭据、没有真实品牌采集、没有模型调用或付费视频测试。TikHub 适配测试使用合成响应；API 返回字段仍需真实账号验证。浏览器整理记录使用 localStorage；更换 origin 不保证连续，需导出留存。

## 外部报告格式

入口位于「已有分析结果？导入报告」。报告是外部 Agent 的分析结果；不会因为格式通过便当作已验证结论。

```json
{
  "schemaVersion": 1,
  "accountUrl": "https://www.instagram.com/brand/",
  "source": "分析器名称 / 版本",
  "analyzedAt": "2026-10-10T00:00:00Z",
  "types": [{
    "type": "视频类型",
    "tone": "依据样本观察的调性",
    "rhythm": "依据镜头时间的节奏",
    "hook": "开头做什么",
    "subtitles": "字幕观察，未知写未知",
    "reason": "结合用户目标的推荐理由",
    "editPlan": "混剪建议",
    "replicaPlan": "复刻建议",
    "requiredAssets": ["所需画面，库存尚待核对"],
    "evidence": [
      {"url":"https://www.instagram.com/reel/SAMPLE_A/","start":0,"end":3,"observation":"示意字段；应填写真实画面观察"},
      {"url":"https://www.instagram.com/reel/SAMPLE_B/","start":2,"end":5,"observation":"示意字段；应填写真实画面观察"}
    ]
  }]
}
```

上面的代码和账号都是格式示例，不是任何真实品牌的分析。

## 验证

`node --test apps/studio/test/account-benchmark.test.mjs`：8 项 mock/离线检查。

覆盖账号与单视频识别、域名/凭据限制、缺失指标、重复/照片/账号筛选、异常响应、明确 consent、单次请求边界及密钥不出现在输出中。`node --check apps/studio/server.mjs` 通过。
