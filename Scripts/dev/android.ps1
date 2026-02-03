<#
.SYNOPSIS
    Android 端开发启动脚本

.DESCRIPTION
    启动 Android 开发服务器，支持热重载和 HMR

.PARAMETER NoInstall
    跳过依赖安装

.PARAMETER NoInstallApk
    不自动构建和安装 APK（纯开发模式）
#>
param(
    [switch]$NoInstall,
    [switch]$NoInstallApk
)

$ErrorActionPreference = "Stop"

# 导入共享配置
. "$PSScriptRoot/../_shared/config.ps1"

Clear-Host
Write-Header "ExoMind Android 开发模式"

# 切换到项目根目录
Set-Location $Global:EMConfig.ProjectRoot

# 检查项目目录
Test-ProjectRoot

# 设置 Java 环境
Set-JavaEnvironment

# 检查 ADB
$adbPath = Test-ADB

# 检查设备连接
$devices = Get-AndroidDevices
if (-not $devices) {
    Write-Error "未检测到 Android 设备，请连接设备或启动模拟器"
    exit 1
}

$targetDevice = ($devices -split "\s+")[0]
Write-Success "Detected device: $targetDevice"

# 安装依赖
if (-not $NoInstall) {
    if (-not (Test-Path (Join-Path $Global:EMConfig.ProjectRoot "node_modules"))) {
        Write-Host "[1/2] 安装依赖..." -ForegroundColor Yellow
        bun install
    }
}

Write-Host ""
Write-Host "=== 启动 Android 开发服务器 ===" -ForegroundColor Green
Write-Host ""
Write-Host "特性:" -ForegroundColor Gray
Write-Host "  - 需要连接 Android 设备或启动模拟器"
Write-Host "  - 支持热重载（前端代码）"
Write-Host "  - 支持 Hot Module Replacement (HMR)"
Write-Host "  - 设备断开后需重新运行"
Write-Host ""
Write-Host "快捷键:" -ForegroundColor Gray
Write-Host "  Ctrl+C - 停止服务器"
Write-Host ""

if ($NoInstallApk) {
    # 纯开发模式，带热重载
    bun run tauri android dev
} else {
    # 先构建 APK 并安装，然后启动开发服务器
    Write-Host "构建并安装 APK..." -ForegroundColor Yellow
    bun run tauri android build --apk

    $apkPath = Join-Path $Global:EMConfig.ProjectRoot "src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk"
    if (Test-Path $apkPath) {
        & $adbPath -s $targetDevice install -r $apkPath
        Write-Success "APK installed"
    }

    Write-Host ""
    Write-Host "启动开发服务器..." -ForegroundColor Green
    bun run tauri android dev
}
