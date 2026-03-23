# dev.ps1 - ExoMind 多设备同步一键启动脚本

$ErrorActionPreference = "Stop"

function Resolve-Port {
    param(
        [string]$Value,
        [int]$Default
    )

    $parsed = 0
    if ([int]::TryParse($Value, [ref]$parsed) -and $parsed -ge 1 -and $parsed -le 65535) {
        return $parsed
    }

    return $Default
}

$webPort = Resolve-Port $env:EXOMIND_WEB_PORT 0
# If no explicit port, find a free one (未指定端口时自动寻找空闲端口)
if ($webPort -eq 0) {
    $findPortScript = Join-Path $PSScriptRoot "Scripts\dev\find-free-port.ts"
    if (Test-Path -LiteralPath $findPortScript) {
        try {
            $freePort = (& bun $findPortScript 1420 2>$null).Trim()
            if ($freePort -match '^\d+$') {
                $webPort = [int]$freePort
            } else {
                $webPort = 1420
            }
        } catch {
            $webPort = 1420
        }
    } else {
        $webPort = 1420
    }
}
$hmrPort = Resolve-Port $env:EXOMIND_HMR_PORT (if ($webPort -lt 65535) { $webPort + 1 } else { 1421 })
$pouchdbPort = Resolve-Port $env:EXOMIND_POUCHDB_PORT 6984
$asrPort = Resolve-Port $env:EXOMIND_ASR_PORT 1949

$env:EXOMIND_WEB_PORT = "$webPort"
$env:EXOMIND_HMR_PORT = "$hmrPort"
$env:EXOMIND_POUCHDB_PORT = "$pouchdbPort"
$env:EXOMIND_ASR_PORT = "$asrPort"

if (-not $env:VITE_SYNC_SERVER_URL) {
    $env:VITE_SYNC_SERVER_URL = "http://localhost:$pouchdbPort"
}
if (-not $env:VITE_ASR_SERVER_URL) {
    $env:VITE_ASR_SERVER_URL = "http://localhost:$asrPort"
}

Write-Host "ExoMind 多设备同步开发环境" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host "端口配置:" -ForegroundColor White
Write-Host "  - Web:      $webPort" -ForegroundColor White
Write-Host "  - HMR:      $hmrPort" -ForegroundColor White
Write-Host "  - PouchDB:  $pouchdbPort" -ForegroundColor White
Write-Host "  - ASR:      $asrPort" -ForegroundColor White

# 检查并安装依赖
if (-not (Test-Path "node_modules/@pouchdb/server")) {
    Write-Host "正在安装 PouchDB Server..." -ForegroundColor Yellow
    bun add @pouchdb/server @pouchdb/core @pouchdb/adapter-idb pouchdb
}

$stdoutLog = "server/server.log"
$stderrLog = "server/server.error.log"

# 启动服务器（后台）
Write-Host "[1/2] 启动 PouchDB 同步服务器..." -ForegroundColor Green
$serverProcess = Start-Process -FilePath "bun" -ArgumentList "run", "server/pouchdb-server.js" -NoNewWindow -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog

# 等待服务器启动
Start-Sleep -Seconds 3

# 检查服务器是否运行
$serverLog = Get-Content $stdoutLog -Tail 20 -ErrorAction SilentlyContinue
if ($serverLog -match "running|PouchDB|Server") {
    Write-Host "[OK] 服务器已启动在 http://localhost:$pouchdbPort" -ForegroundColor Green
} else {
    Write-Host "[ERROR] 服务器启动失败，查看 $stdoutLog 和 $stderrLog" -ForegroundColor Red
    Get-Content $stdoutLog -Tail 20 -ErrorAction SilentlyContinue
    Get-Content $stderrLog -Tail 20 -ErrorAction SilentlyContinue
    exit 1
}

# 打开测试浏览器
Write-Host "[2/2] 打开测试浏览器..." -ForegroundColor Green
Write-Host "   - 主窗口: http://localhost:$webPort" -ForegroundColor White
Write-Host "   - 第二窗口需手动打开并登录不同账户测试同步" -ForegroundColor White

# 打开主窗口
Start-Process "http://localhost:$webPort"

Write-Host "" -ForegroundColor Cyan
Write-Host "提示：在第二浏览器打开 http://localhost:$webPort 并登录不同账户测试多设备同步" -ForegroundColor Yellow
Write-Host "按 Ctrl+C 停止所有服务" -ForegroundColor Yellow

# 启动 Vite 前端
bun run dev
