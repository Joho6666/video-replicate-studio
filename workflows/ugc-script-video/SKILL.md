---
name: ugc-script-video
description: Turn a timecoded script (EN/CN) plus a product image into a 1–2 min UGC talking-head ad at minimum cost — shot list, storyboard stills, free animatic, then only the paid H3 shots. Trigger on "脚本做视频", "UGC 口播", "分镜图", "批量做视频", script-to-video.
---

# ugc-script-video

Principle: the agent decides WHAT (shot split, source per shot, prompts, QC); the scripts decide HOW for anything that costs money or has state. Never spend before the previous gate is approved by the user.

Working dir per script: `PROJECT_DIR` (default cwd) with `assets/` (presenter_*.jpg, product image), `voice/`, `board/`, `h3/`, `out/`, `shots.json`. Scripts in `scripts/` are templates: copy them in, edit the script-specific parts (LINES/CHUNKS in step2_voice, CHUNKS in step3_h3).

Keys come from the environment only (`MINIMAX_API_KEY`, `MOSS_API_KEY`); read them from the user's gitignored `.env.local`, never print or write them elsewhere.

## Funnel (each gate needs user OK)
0. **Shot list** → `shots.json`. Each shot: start/end, line, `source` = `h3` (existing clip+in-point) | `still` (storyboard image, push-in) | `client` (real person/asset from client — never AI-fake an expert) | `h3_new` (paid). Default to `still`; use `h3_new` only for on-camera talking moments, ≤5–10 s per video. Reuse presenter and product stills for free.
1. **Voice**: `voice_pick.mjs "<name>"` reads line 1 (cents). User approves by ear. Preset Mossland voices are not listable via API — user copies the voice ID from the card. Then `VOICE_ID=<id> node step2_voice.mjs` (~¥0.3, durations pinned to script timing).
2. **Stills**: test ONE character shot with `node board.mjs S04`, compare to presenter (`hstack` image, look at it). Only then `node board.mjs` for the rest. Regenerate single shots with `<id> --again`. Character shots pass the presenter as `subject_reference`.
3. **Animatic** (free, local ffmpeg): `node animatic.mjs out/x.mp4`. Missing assets become labelled placeholder cards. **Gate 1**: user reviews.
4. **Paid shots**: list every `h3_new` shot with seconds × ¥0.5 (768P) and total; get explicit OK (**Gate 2**). Cut its audio from `voice/full.wav` to `voice/chunk-N.mp3`, add it to CHUNKS, run `node step3_h3.mjs N` — one shot at a time, first result reviewed before the next. Ledger `h3/chunk-N.json`: never resubmit submitting/submitted/unknown; never auto-retry. Audio data URI must be `audio/mp3`.
5. **Final + QC**: point the shot at the new clip in shots.json, re-run animatic, extract frames (identity consistent? lips moving? captions readable? nothing cut off?). Report actual spend.

## Rules
- Test paid calls at minimum (H3 4 s, 768P), one variable at a time. Never regenerate when inputs are unchanged. Changing voice after H3 clips exist makes lip-sync approximate — say so.
- Compliance for supplement/weight-loss scripts: AI-spokesperson disclosure + FDA disclaimer in the end frames; flag "personal testimony" and efficacy claims to the user; platform ad rules.
- Batch: run steps 0–3 for all scripts first (cheap), review each animatic, then do paid shots per script in approved order under a total budget the user states. Reuse the same presenter/voice across scripts.
- Record progress in a handoff file in PROJECT_DIR.
