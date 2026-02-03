<#
.SYNOPSIS
    显示所有开发启动命令

.DESCRIPTION
    桌面端和 Android 端需要分别在不同的终端窗口中运行
    此脚本用于展示启动命令

.PARAMETER OnlyDesktop
    只显示桌面端启动命令

.PARAMETER OnlyAndroid
    只显示 Android 端启动命令
#>
param(
    [switch]$OnlyDesktop,
    [switch]$OnlyAndroid
)

$ErrorActionPreference = "Stop"

# 导入共享配置
. "$PSScriptRoot/../_shared/config.ps1"

Clear-Host
Write-Header "ExoMind 开发启动命令"

if (-not $OnlyAndroid) {
    Write-Host "=== 桌面端开发 ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  命令: .\dev\desktop.ps1"
    Write-Host "  或:   bun run tauri dev"
    Write-Host ""
    Write-Host "  特性:" -ForegroundColor Gray
    Write-Host "    - 本地运行，无需额外设备"
    Write-Host "    - 前端代码自动热重载"
    Write-Host "    - Rust 代码修改后需要重启"
    Write-Host ""
}

if (-not $OnlyDesktop) {
    Write-Host "=== Android 端开发 ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "  命令: .\dev\android.ps1"
    Write-Host "  或:   bun run tauri android dev"
    Write-Host ""
    Write-Host "  特性:" -ForegroundColor Gray
    Write-Host "    - 需要连接 Android 设备或启动模拟器"
    Write-Host "    - 支持热重载（前端代码）"
    Write-Host "    - 支持 Hot Module Replacement (HMR)"
    Write-Host "    - 设备断开需重新运行"
    Write-Host ""
}

Write-Host "注意：" -ForegroundColor Yellow
Write-Host "  桌面端和 Android 端需要分别在不同的终端窗口中运行" -ForegroundColor Yellow
Write-Host ""
Write-Host "快捷方式:" -ForegroundColor Cyan
Write-Host "  桌面端: cd Scripts; .\dev\desktop.ps1"
Write-Host "  Android: cd Scripts; .\dev\android.ps1"
Write-Host ""
