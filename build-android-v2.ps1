# Tauri Android Build Script v2
# Features: Build time tracking, detailed statistics, colored output
# 用法: .\build-android-v2.ps1 [-Install] [-Clean] [-Verbose]

param(
    [switch]$Install,    # 构建后自动安装到设备
    [switch]$Clean,      # 深度清理（包括Gradle缓存）
    [switch]$Verbose     # 详细输出
)

$ErrorActionPreference = "Stop"

# ========================================
# 配置
# ========================================
$JAVA_17 = "D:\data\AndroidStudioSDK\java17"
$SCRIPT_VERSION = "2.0"

# ========================================
# 计时器类
# ========================================
$Global:BuildTimer = [System.Diagnostics.Stopwatch]::new()
$Global:StageTimers = @()

function Start-BuildTimer {
    $Global:BuildTimer.Reset()
    $Global:BuildTimer.Start()
    $Global:StageTimers = @()
}

function Stop-BuildTimer {
    $Global:BuildTimer.Stop()
    return $Global:BuildTimer.Elapsed
}

function Start-Stage {
    param([string]$StageName)
    $stage = @{
        Name = $StageName
        StartTime = Get-Date
        Timer = [System.Diagnostics.Stopwatch]::new()
    }
    $stage.Timer.Start()
    return $stage
}

function Stop-Stage {
    param([hashtable]$Stage)
    $Stage.Timer.Stop()
    $Stage.EndTime = Get-Date
    $Stage.Duration = $Stage.Timer.Elapsed
    $Global:StageTimers += $Stage
    return $Stage.Duration
}

function Format-Duration {
    param([TimeSpan]$Duration)
    if ($Duration.TotalHours -ge 1) {
        return "$($Duration.Hours)小时 $($Duration.Minutes)分 $($Duration.Seconds)秒"
    } elseif ($Duration.TotalMinutes -ge 1) {
        return "$($Duration.Minutes)分 $($Duration.Seconds)秒"
    } else {
        return "$($Duration.Seconds).$([math]::Floor($Duration.Milliseconds / 10))秒"
    }
}

# ========================================
# 输出函数
# ========================================
function Write-Header {
    param([string]$Text, [string]$Color = "Cyan")
    Write-Host ""
    Write-Host "========================================" -ForegroundColor $Color
    Write-Host "  $Text" -ForegroundColor $Color
    Write-Host "========================================" -ForegroundColor $Color
    Write-Host ""
}

function Write-Stage {
    param([int]$Number, [int]$Total, [string]$Text)
    Write-Host "[$Number/$Total] $Text" -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Text)
    Write-Host "  [OK] $Text" -ForegroundColor Green
}

function Write-Error {
    param([string]$Text)
    Write-Host "  [FAIL] $Text" -ForegroundColor Red
}

function Write-Info {
    param([string]$Text)
    Write-Host "  [INFO] $Text" -ForegroundColor Gray
}

function Write-Duration {
    param([string]$Label, [TimeSpan]$Duration)
    $formatted = Format-Duration $Duration
    Write-Host "  $Label`: " -NoNewline
    Write-Host $formatted -ForegroundColor Cyan
}

# ========================================
# 主程序
# ========================================
Clear-Host
Start-BuildTimer

Write-Header "Tauri Android Build Script v$SCRIPT_VERSION"

# 记录开始时间
$buildStartTime = Get-Date
Write-Host "构建开始时间: $($buildStartTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Gray
Write-Host ""

# ========================================
# 阶段 0: 环境检查
# ========================================
$stage0 = Start-Stage "Environment Check"
Write-Stage 0 5 "检查环境..."

# 检查 Java 17
if (-not (Test-Path $JAVA_17)) {
    Write-Error "Java 17 not found at: $JAVA_17"
    exit 1
}

# 设置环境变量
$env:JAVA_HOME = $JAVA_17
$env:PATH = "$JAVA_17\bin;" + $env:PATH

# 验证 Java 版本
$javaVersionOutput = java -version 2>&1
$javaVersion = ($javaVersionOutput | Select-String "version").ToString().Split('"')[1]
Write-Success "Java version: $javaVersion"

# 检查项目结构
if (-not (Test-Path "src-tauri")) {
    Write-Error "Not in project root directory"
    exit 1
}

if (-not (Test-Path "src-tauri/gen/android")) {
    Write-Error "Android project not initialized"
    Write-Host "Run: bun run tauri android init" -ForegroundColor Yellow
    exit 1
}

Write-Success "Project structure OK"
Stop-Stage $stage0 | Out-Null

# ========================================
# 阶段 1: 清理
# ========================================
$stage1 = Start-Stage "Cleanup"
Write-Stage 1 5 "清理旧构建产物..."

$cleanPaths = @(
    "src-tauri/target/aarch64-linux-android",
    "src-tauri/target/armv7-linux-androideabi",
    "src-tauri/target/i686-linux-android",
    "src-tauri/target/x86_64-linux-android"
)

$cleanedCount = 0
foreach ($path in $cleanPaths) {
    if (Test-Path $path) {
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
        $cleanedCount++
        if ($Verbose) { Write-Info "Cleaned: $path" }
    }
}

if ($Clean) {
    Write-Host "  Deep cleaning Gradle cache..." -ForegroundColor DarkGray
    if (Test-Path "$env:USERPROFILE\.gradle\caches") {
        Remove-Item -Recurse -Force "$env:USERPROFILE\.gradle\caches" -ErrorAction SilentlyContinue
    }
}

Write-Success "Cleaned $cleanedCount directories"
Stop-Stage $stage1 | Out-Null

# ========================================
# 阶段 2: 安装依赖
# ========================================
$stage2 = Start-Stage "Dependencies"
Write-Stage 2 5 "安装依赖..."

try {
    $output = bun install 2>&1
    if ($LASTEXITCODE -ne 0) { throw $output }
    Write-Success "Dependencies installed"
} catch {
    Write-Error "Failed to install dependencies: $_"
    exit 1
}
Stop-Stage $stage2 | Out-Null

# ========================================
# 阶段 3: 构建前端
# ========================================
$stage3 = Start-Stage "Frontend Build"
Write-Stage 3 5 "构建前端..."

try {
    $output = bun run build 2>&1
    if ($LASTEXITCODE -ne 0) { throw $output }

    # 获取构建产物大小
    $distSize = (Get-ChildItem -Recurse -File -Path "dist" -ErrorAction SilentlyContinue |
                Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Success "Frontend built ($([math]::Round($distSize, 2)) MB)"
} catch {
    Write-Error "Frontend build failed: $_"
    exit 1
}
Stop-Stage $stage3 | Out-Null

# ========================================
# 阶段 4: 构建 Android
# ========================================
$stage4 = Start-Stage "Android Build"
Write-Stage 4 5 "构建 Android APK..."
Write-Host "  This may take several minutes..." -ForegroundColor DarkGray
Write-Host ""

try {
    if ($Verbose) {
        bun run tauri android build --apk
    } else {
        $output = bun run tauri android build --apk 2>&1
        if ($LASTEXITCODE -ne 0) { throw $output }
    }
    Write-Success "Android APK built successfully"
} catch {
    Write-Error "Android build failed: $_"
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  1. Check Android SDK/NDK installation" -ForegroundColor Yellow
    Write-Host "  2. Run: bun run tauri android dev" -ForegroundColor Yellow
    Write-Host "  3. Check src-tauri/gen/android exists" -ForegroundColor Yellow
    exit 1
}
Stop-Stage $stage4 | Out-Null

# ========================================
# 构建完成统计
# ========================================
$totalTime = Stop-BuildTimer
$buildEndTime = Get-Date

Write-Header "Build Statistics" "Green"

# 时间统计表格
Write-Host "阶段耗时明细:" -ForegroundColor Cyan
Write-Host "----------------------------------------"

foreach ($stage in $Global:StageTimers) {
    $duration = $stage.Duration
    $barLength = [math]::Min([math]::Floor($duration.TotalSeconds / 2), 30)
    $bar = "█" * $barLength
    $timeStr = Format-Duration $duration
    Write-Host "  $($stage.Name.PadRight(20)) $bar $timeStr"
}

Write-Host "----------------------------------------"
Write-Host "  总耗时`.PadRight(20)) " -NoNewline
Write-Host ("█" * [math]::Min([math]::Floor($totalTime.TotalSeconds / 2), 30)) -NoNewline -ForegroundColor Green
Write-Host " $(Format-Duration $totalTime)" -ForegroundColor Green

Write-Host ""
Write-Host "时间信息:" -ForegroundColor Cyan
Write-Host "  开始时间: $($buildStartTime.ToString('HH:mm:ss'))"
Write-Host "  结束时间: $($buildEndTime.ToString('HH:mm:ss'))"
Write-Host "  日期: $($buildStartTime.ToString('yyyy-MM-dd'))"

# ========================================
# 输出文件信息
# ========================================
Write-Host ""
Write-Host "构建产物:" -ForegroundColor Cyan

$apkDir = "src-tauri/gen/android/app/build/outputs/apk"
$foundApk = $false

if (Test-Path $apkDir) {
    $apkFiles = Get-ChildItem -Path $apkDir -Recurse -Filter "*.apk" | Sort-Object Length -Descending
    if ($apkFiles) {
        $foundApk = $true
        foreach ($apk in $apkFiles) {
            $sizeMB = [math]::Round($apk.Length / 1MB, 2)
            $created = $apk.CreationTime.ToString("HH:mm:ss")
            Write-Host "  $($apk.Name)" -ForegroundColor White
            Write-Host "    路径: $($apk.FullName)"
            Write-Host "    大小: $sizeMB MB"
            Write-Host "    生成时间: $created"
            Write-Host ""
        }
    }
}

if (-not $foundApk) {
    Write-Warning "No APK files found"
}

# ========================================
# 安装到设备
# ========================================
if ($Install) {
    Write-Host "安装到设备..." -ForegroundColor Cyan
    $mainApk = $apkFiles | Select-Object -First 1
    if ($mainApk) {
        try {
            adb install -r $mainApk.FullName
            Write-Success "Installed to device"
        } catch {
            Write-Error "Install failed: $_"
            Write-Host "Make sure device is connected and USB debugging is enabled" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host ""
    Write-Host "安装命令:" -ForegroundColor Cyan
    if ($apkFiles) {
        $mainApk = $apkFiles | Select-Object -First 1
        Write-Host "  adb install -r `"$($mainApk.FullName)`"" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "Tip: Use -Install flag to auto-install: .\build-android-v2.ps1 -Install" -ForegroundColor DarkGray
}

# ========================================
# 保存构建日志
# ========================================
$logDir = "build-logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$logFile = "$logDir/android-build-$($buildStartTime.ToString('yyyyMMdd-HHmmss')).log"
$logContent = @"
Tauri Android Build Log
======================
Build Date: $($buildStartTime.ToString('yyyy-MM-dd HH:mm:ss'))
Duration: $(Format-Duration $totalTime)
Java Version: $javaVersion

Stage Timings:
$($Global:StageTimers | ForEach-Object { "  $($_.Name): $(Format-Duration $_.Duration)" } | Out-String)

Output Files:
$($apkFiles | ForEach-Object { "  $($_.FullName) ($([math]::Round($_.Length / 1MB, 2)) MB)" } | Out-String)
"@

$logContent | Out-File -FilePath $logFile -Encoding UTF8
Write-Host ""
Write-Info "Build log saved: $logFile"

# ========================================
# 完成
# ========================================
Write-Header "Build Complete!" "Green"

# 播放提示音（Windows）
[console]::beep(800, 200)
Start-Sleep -Milliseconds 100
[console]::beep(1000, 300)

pause
