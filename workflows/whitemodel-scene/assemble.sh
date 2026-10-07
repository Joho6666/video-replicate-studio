#!/usr/bin/env bash
# 用法: bash assemble.sh S1.mp4 S2.mp4 S3.mp4 → final.mp4（每段 5 秒，0.5 秒交叉淡化）
set -e
FF=${FFMPEG:-ffmpeg}
"$FF" -y -loglevel error -i "$1" -i "$2" -i "$3" -filter_complex "[0:v]fps=30,format=yuv420p[a];[1:v]fps=30,format=yuv420p[b];[2:v]fps=30,format=yuv420p[c];[a][b]xfade=transition=fade:duration=0.5:offset=4.5[ab];[ab][c]xfade=transition=fade:duration=0.5:offset=9.0[v]" -map "[v]" -c:v libx264 -crf 17 -pix_fmt yuv420p final.mp4
