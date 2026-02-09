@echo off
REM 火山引擎 ASR 后端启动脚本
REM 使用方法: run-asr-backend.bat

echo ==================================================
echo   火山引擎 ASR 后端服务
echo ==================================================

REM 加载环境变量
for /f "tokens=1,2 delims==" %%a in (.env) do (
    set %%a=%%b
)

REM 设置环境变量
set VOLCANO_APP_KEY=%VITE_VOLCANO_APP_KEY%
set VOLCANO_ACCESS_KEY=%VITE_VOLCANO_ACCESS_KEY%
set VOLCANO_RESOURCE_ID=%VITE_VOLCANO_RESOURCE_ID%

echo 端口: 1948
echo APP Key: %VOLCANO_APP_KEY%
echo Resource: %VOLCANO_RESOURCE_ID%
echo ==================================================

REM 启动后端服务
bun run src/backend/server.ts

pause
