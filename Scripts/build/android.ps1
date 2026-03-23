<#
.SYNOPSIS
    Android 端构建脚本

.DESCRIPTION
    构建 Android APK，支持自动安装到连接设备

.PARAMETER Install
    构建后自动安装到连接设备

.PARAMETER Release
    构建发布版本（需要签名）

.PARAMETER Device
    指定设备安装（默认自动检测第一个设备）
#>
param(
    [switch]$Install,
    [switch]$Release,
    [string]$Device
)

$ErrorActionPreference = "Stop"

# 导入共享配置
. "$PSScriptRoot/../_shared/config.ps1"

Clear-Host
Start-BuildTimer

Write-Header "ExoMind Android 构建脚本 v$($Global:EMConfig.ScriptVersion)"

$buildStartTime = Get-Date
Write-Info "Started: $($buildStartTime.ToString('yyyy-MM-dd HH:mm:ss'))"

# 切换到项目根目录
Set-Location $Global:EMConfig.ProjectRoot

# ========================================
# 阶段 0: 环境设置
# ========================================
$stage0 = Start-Stage "Environment"
Write-Stage 0 5 "Setting up environment..."

Set-JavaEnvironment
$adbPath = Test-ADB

# 检查设备
$targetDevice = $null
if ($Install) {
    if ($Device) {
        $targetDevice = $Device
    } else {
        $devices = Get-AndroidDevices
        if (-not $devices) {
            Write-Error "No device connected. Use -Install to skip installation."
            exit 1
        }
        $targetDevice = ($devices -split "\s+")[0]
    }
    Write-Success "Target device: $targetDevice"
}

Stop-Stage $stage0 | Out-Null

# ========================================
# 阶段 1: 项目检查
# ========================================
$stage1 = Start-Stage "Check"
Write-Stage 1 5 "Checking project..."

Test-ProjectRoot

$androidPath = Join-Path $Global:EMConfig.ProjectRoot "src-tauri\gen\android"
if (-not (Test-Path $androidPath)) {
    Write-Error "Android not initialized. Run: bun run tauri android init"
    exit 1
}
Write-Success "Project OK"

Stop-Stage $stage1 | Out-Null

# ========================================
# 阶段 2: 清理
# ========================================
$stage2 = Start-Stage "Clean"
Write-Stage 2 5 "Cleaning..."

@("aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android") | ForEach-Object {
    $path = Join-Path $Global:EMConfig.ProjectRoot "src-tauri\target\$_"
    if (Test-Path $path) {
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
    }
}
Write-Success "Cleaned target directories"

Stop-Stage $stage2 | Out-Null

# ========================================
# 阶段 3: 依赖安装
# ========================================
$stage3 = Start-Stage "Dependencies"
Write-Stage 3 5 "Installing dependencies..."

bun install | Out-Null
Write-Success "Dependencies installed"

Stop-Stage $stage3 | Out-Null

# ========================================
# 阶段 4: 前端构建
# ========================================
$stage4 = Start-Stage "Frontend"
Write-Stage 4 5 "Building frontend..."

bun run build | Out-Null
Write-Success "Frontend built"

Stop-Stage $stage4 | Out-Null

# ========================================
# 阶段 5: Android 构建
# ========================================
$stage5 = Start-Stage "Android"
Write-Stage 5 5 "Building Android APK..."
Write-Host "  This may take 3-5 minutes..." -ForegroundColor Gray

$buildType = if ($Release) { "release" } else { "debug" }
Write-Host "  Build type: $buildType" -ForegroundColor Gray

# Ensure generated Android res uses the latest app icon (确保使用最新 App 图标)
Write-Host "  Syncing Android launcher icons..." -ForegroundColor DarkGray
Sync-AndroidLauncherIcons -ProjectRoot $Global:EMConfig.ProjectRoot

if ($Release) {
    bun run tauri android build --apk | Out-Null
} else {
    # Debug build via gradle (avoids WebSocket issue)
    $gradlePath = Join-Path $Global:EMConfig.ProjectRoot "src-tauri\gen\android"
    Set-Location $gradlePath
    .\gradlew assembleDebug --no-daemon -q | Out-Null
    Set-Location $Global:EMConfig.ProjectRoot
}
Write-Success "APK built"

Stop-Stage $stage5 | Out-Null

# ========================================
# 查找 APK
# ========================================
$apkPath = if ($Release) {
    Join-Path $Global:EMConfig.ProjectRoot "src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
} else {
    Join-Path $Global:EMConfig.ProjectRoot "src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk"
}

if (-not (Test-Path $apkPath)) {
    # Try to find any APK
    $androidOutPath = Join-Path $Global:EMConfig.ProjectRoot "src-tauri\gen\android"
    $apk = Get-ChildItem -Path $androidOutPath -Recurse -Filter "*.apk" | Select-Object -First 1
    if ($apk) {
        $apkPath = $apk.FullName
    } else {
        Write-Error "APK not found"
        exit 1
    }
}

# 签名（如果需要）
if ($Release -and $apkPath -like "*unsigned*") {
    Write-Host "`n[Signing] Release APK needs signing..." -ForegroundColor Yellow
    $keystore = Join-Path $Global:EMConfig.ProjectRoot "my-release-key.jks"
    if (-not (Test-Path $keystore)) {
        Write-Host "  Creating keystore..." -ForegroundColor Gray
        $keytool = Join-Path $Global:EMConfig.Java17 "bin\keytool.exe"
        & $keytool -genkey -v -keystore $keystore -keyalg RSA -keysize 2048 -validity 10000 -alias tauri-app -storepass password -keypass password -dname "CN=Test, OU=Test, O=Test, L=Test, ST=Test, C=US" | Out-Null
    }
    $apksigner = Join-Path $Global:EMConfig.AndroidSdk "build-tools\36.1.0\apksigner.bat"
    & $apksigner sign --ks $keystore --ks-pass pass:password --key-pass pass:password $apkPath | Out-Null
    Write-Success "APK signed"
}

$apkInfo = Get-Item $apkPath
$apkSizeMB = [math]::Round($apkInfo.Length / 1MB, 2)

# ========================================
# 安装
# ========================================
if ($Install -and $targetDevice) {
    Write-Host "`n[Installing] to $targetDevice..." -ForegroundColor Yellow
    & $adbPath -s $targetDevice install -r $apkPath | Out-Null
    Write-Success "Installed successfully"
}

# ========================================
# 构建完成统计
# ========================================
$totalTime = Stop-BuildTimer
$buildEndTime = Get-Date

Write-Header "Build Summary" "Green"

Write-Host "`nStage Timings:" -ForegroundColor Cyan
Write-Host "----------------------------------------"
foreach ($stage in $Global:StageTimers) {
    Write-Host "  $($stage.Name.PadRight(15)) $(Format-Duration $stage.Duration)"
}
Write-Host "----------------------------------------"
Write-Host "  TOTAL                          $(Format-Duration $totalTime)" -ForegroundColor Green

Write-Host "`nOutput:" -ForegroundColor Cyan
Write-Host "  File: $apkPath"
Write-Host "  Size: $apkSizeMB MB"
Write-Host "  Type: $(if ($Release) { "Release" } else { "Debug" })"

if ($Install -and $targetDevice) {
    Write-Host "`nInstallation:" -ForegroundColor Cyan
    Write-Host "  Device: $targetDevice"
    Write-Host "  Status: Success"
}

Write-Host "`nTime: $($buildStartTime.ToString('HH:mm:ss')) -> $($buildEndTime.ToString('HH:mm:ss'))" -ForegroundColor Gray

# 保存日志
$foundFiles = @($apkInfo)
Save-BuildLog -Type "android" -StartTime $buildStartTime -Duration $totalTime -OutputFiles $foundFiles

Write-Header "Completed!" "Green"
Invoke-CompletionBeep
