# 白模复刻（grey-box → live action）

对标视频 → 白模（只留镜头、站位、动作、节奏）→ 生成式改视频把白模渲染成真人和真实场景 → 按原片剪辑点拼回整条。
实测和结论见 [docs/BLOCKOUT_REPLICA_2026-10-11.md](../../docs/BLOCKOUT_REPLICA_2026-10-11.md)。

| 文件 | 作用 |
| --- | --- |
| `derive_blockout.py` | **自动派生白模**：RVM 抠出的人物变成浅灰人形，场景去色、压成 6 级灰、平滑，只留结构与运动。不用 3D 建模，适合有走动、运镜、快剪的视频 |
| `era_scene.py` | **Blender 程序化白模**示例（固定俯拍、地毯、沙发、躺着的人形、吊扇）。`BLOCKOUT_ROBE=1` 时人形穿长袍（深度/线稿控制下更像人） |
| `track_keys.py` | 从原片逐帧追踪运动物体（示例：扇叶），生成 Blender 关键帧，让白模节奏与原片逐帧对齐 |
| `edit_run.mjs` | 一个窗口：白模 + 参考图 → `wan2.7-videoedit`；先写账本再提交，保存的 taskId 只续查不重提，超过确认金额拒绝提交 |

## 步骤

```bash
# 1. 自动派生白模（需要 apps/studio/.env.local 里的 PYTHON_PATH 和 RVM_MODEL）
ffmpeg -i source.mp4 -vf fps=30 frames/%04d.png
python apps/studio/scripts/py/person_swap.py matte frames %04d.png <N> matte --model <rvm.onnx>
python workflows/blockout-replica/derive_blockout.py frames matte <N> grey
ffmpeg -framerate 30 -i grey/%04d.png -c:v libx264 -crf 14 -pix_fmt yuv420p grey.mp4

# 1'. 或者 Blender 程序化白模（无界面渲染）
python workflows/blockout-replica/track_keys.py source.mp4 workflows/blockout-replica/fan_keys.json
blender -b -P workflows/blockout-replica/era_scene.py -- out_grey grey

# 2. 按原片剪辑点切镜头，每个镜头一个窗口（不足 2 秒的镜头：正放 + 倒放补到 2 秒，生成后只取原长）
node workflows/blockout-replica/edit_run.mjs s1 s1_src.mp4 0 2 2.4 s1_prompt.txt presenter.jpg

# 3. ffmpeg 按原片时间轴拼接（trim + tpad 补齐切点的 1–3 帧），再做对比
```

提示词模板（每个镜头只写这个镜头里有的东西）：

> 把这段灰色白模预演视频渲染成真实拍摄的旅行短片画面：灰色的人形替换为图1中的真实女性，脸、发型和发色与图1一致，真实皮肤和衣料质感，动作和位置保持不变。〈场景与服装〉。镜头运动、构图和节奏全部保持不变，电影感色彩。

每次付费前先报价并确认；`edit_run.mjs` 的第 5 个参数就是确认过的金额。
