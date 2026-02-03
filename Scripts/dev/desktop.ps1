<#
.SYNOPSIS
    Windows 桌面端开发启动脚本

.DESCRIPTION
    启动桌面端开发服务器，支持热重载

.PARAMETER NoInstall
    跳过依赖安装
#>
param(
    [switch]$NoInstall
)

$ErrorActionPreference = "Stop"

# 导入共享配置
. "$PSScriptRoot/../_shared/config.ps1"

Clear-Host
Write-Header "ExoMind 桌面端开发模式"

# 切换到项目根目录
Set-Location $Global:EMConfig.ProjectRoot

# 检查项目目录
Test-ProjectRoot

# 安装依赖
if (-not $NoInstall) {
    if (-not (Test-Path (Join-Path $Global:EMConfig.ProjectRoot "node_modules"))) {
        Write-Host "[1/2] 安装依赖..." -ForegroundColor Yellow
        bun install
    }
}

Write-Host ""
Write-Host "=== 启动桌面端开发服务器 ===" -ForegroundColor Green
Write-Host ""
Write-Host "特性:" -ForegroundColor Gray
Write-Host "  - 本地运行，无需额外设备"
Write-Host "  - 前端代码自动热重载 (HMR)"
Write-Host "  - Rust 代码修改后需要重启"
Write-Host ""
Write-Host "快捷键:" -ForegroundColor Gray
Write-Host "  Ctrl+C - 停止服务器"
Write-Host ""

bun run tauri dev
