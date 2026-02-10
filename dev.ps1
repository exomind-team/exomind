# dev.ps1 - ExoMind 多设备同步一键启动脚本

$ErrorActionPreference = "Stop"

Write-Host "ExoMind 多设备同步开发环境" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 检查并安装依赖
if (-not (Test-Path "node_modules/@pouchdb/server")) {
    Write-Host "正在安装 PouchDB Server..." -ForegroundColor Yellow
    bun add @pouchdb/server @pouchdb/core @pouchdb/adapter-idb pouchdb
}

# 启动服务器（后台）
Write-Host "[1/2] 启动 PouchDB 同步服务器..." -ForegroundColor Green
$serverProcess = Start-Process -FilePath "bun" -ArgumentList "run", "server/pouchdb-server.js" -NoNewWindow -PassThru -RedirectStandardOutput "server/server.log" -RedirectStandardError "server/server.error.log"

# 等待服务器启动
Start-Sleep -Seconds 3

# 检查服务器是否运行
$serverLog = Get-Content "server/logs/stdout.log" -Tail 5 -ErrorAction SilentlyContinue
if ($serverLog -match "running|PouchDB|Server") {
    Write-Host "[OK] 服务器已启动在 http://localhost:6984" -ForegroundColor Green
} else {
    Write-Host "[ERROR] 服务器启动失败，查看 server/logs/stdout.log" -ForegroundColor Red
    Get-Content "server/logs/stdout.log" -Tail 20 -ErrorAction SilentlyContinue
    exit 1
}

# 打开测试浏览器
Write-Host "[2/2] 打开测试浏览器..." -ForegroundColor Green
Write-Host "   - 主窗口: http://localhost:5173" -ForegroundColor White
Write-Host "   - 第二窗口需手动打开并登录不同账户测试同步" -ForegroundColor White

# 打开主窗口
Start-Process "http://localhost:5173"

Write-Host "" -ForegroundColor Cyan
Write-Host "提示：在第二浏览器打开 http://localhost:5173 并登录不同账户测试多设备同步" -ForegroundColor Yellow
Write-Host "按 Ctrl+C 停止所有服务" -ForegroundColor Yellow

# 启动 Vite 前端
bun run dev
