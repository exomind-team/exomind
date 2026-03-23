<#
.SYNOPSIS
    全平台构建脚本

.DESCRIPTION
    构建桌面端 + Android 端

.PARAMETER SkipDesktop
    跳过桌面端构建

.PARAMETER SkipAndroid
    跳过 Android 构建

.PARAMETER InstallAndroid
    构建后自动安装到连接设备
#>
param(
    [switch]$SkipDesktop,
    [switch]$SkipAndroid,
    [switch]$InstallAndroid
)

$ErrorActionPreference = "Stop"

# 导入共享配置
. "$PSScriptRoot/../_shared/config.ps1"

Clear-Host
Write-Header "ExoMind 全平台构建脚本 v$($Global:EMConfig.ScriptVersion)"

$buildStartTime = Get-Date
Write-Info "Started: $($buildStartTime.ToString('yyyy-MM-dd HH:mm:ss'))"

# 构建桌面端
if (-not $SkipDesktop) {
    Write-Host "`n=== 构建桌面端 ===" -ForegroundColor Green
    . "$PSScriptRoot/desktop.ps1"
}

# 构建 Android 端
if (-not $SkipAndroid) {
    Write-Host "`n=== 构建 Android 端 ===" -ForegroundColor Green
    if ($InstallAndroid) {
        . "$PSScriptRoot/android.ps1" -Install
    } else {
        . "$PSScriptRoot/android.ps1"
    }
}

Write-Header "全平台构建完成!" "Green"
Invoke-CompletionBeep
