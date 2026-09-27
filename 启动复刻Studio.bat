@echo off
chcp 65001 >nul
title 复刻 Studio
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist "apps\media-crawler\.venv\Scripts\python.exe" goto run
where uv >nul 2>nul
if errorlevel 1 goto nouv
echo [1/2] 首次运行：安装抖音/B站抓取环境，约 3-5 分钟 ...
pushd apps\media-crawler
set UV_CACHE_DIR=%~dp0.cache\uv
set UV_PYTHON_INSTALL_DIR=%~dp0.cache\python
uv sync
popd
goto run

:nouv
echo [提示] 没有找到 uv，抖音 / B站抓取暂不可用；TikTok、Instagram 和本地上传照常可用。
echo        安装方法：powershell -c "irm https://astral.sh/uv/install.ps1 | iex"  然后重新双击本文件。
echo.

:run
echo [2/2] 启动复刻 Studio  →  http://127.0.0.1:3300
echo       关闭这个窗口即停止服务。
start "" "http://127.0.0.1:3300"
node apps\studio\server.mjs
pause
goto :eof

:nonode
echo 需要先安装 Node.js 22 或更高版本：https://nodejs.org/zh-cn
start "" "https://nodejs.org/zh-cn"
pause
