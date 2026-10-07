# 白膜场景出片（Blender 白膜 → 写实首帧 → 图生视频）

原创空间感镜头的工作流：用 Blender 搭灰白体块（白膜）锁定空间、透视和机位，再让 AI 只负责材质与光影。
**不用于“换人复刻”**（原片本身已是结构参考，见主 README 的换人一节）。

```
shots.py（Blender 无界面）→ shots/S*.png 白膜首帧
  → restyle.mjs（qwen-image-edit-plus）→ shots/S*_real.png 写实首帧
  → i2v.mjs（wan2.2-i2v-flash，5 秒/镜）→ S*.mp4
  → assemble.sh（0.5 秒交叉淡化）→ final.mp4
```

## 运行

```bash
cd workflows/whitemodel-scene
blender --background --python shots.py          # 白膜首帧，本地免费，约 3 秒
node restyle.mjs S1                              # 逐张写实化，先只做一张看效果
node i2v.mjs S1 720P "缓慢前推……运镜与动作描述"   # 先 480P 试，再 720P 出片
bash assemble.sh S1.mp4 S2.mp4 S3.mp4
```

- 密钥沿用 `apps/studio` 的 `config.wan`，脚本里不含任何密钥。
- 环境变量：`WM_OUT`（白膜输出目录）、`FFMPEG`（ffmpeg 路径）。
- 示例场景（黄昏古城·穿过拱门）：石巷、圆柱、台阶、拱门、广场三个机位。换主题时改 `shots.py` 的几何体和 `shots` 机位。

详见 `docs/WHITEMODEL_2026-10-07.md`。
