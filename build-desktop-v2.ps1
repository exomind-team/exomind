# Tauri Desktop Build Script v2
# Features: Build time tracking, multiple formats, detailed statistics
# 用法: .\build-desktop-v2.ps1 [-Clean] [-Target <msi|nsis|all>]

param(
    [switch]$Clean,                # 深度清理
    [string]$Target = "all"        # 构建目标: msi, nsis, 或 all
)

$ErrorActionPreference = "Stop"

# ========================================
# 配置
# ========================================
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
        return "$($Duration.Hours)h $($Duration.Minutes)m $($Duration.Seconds)s"
    } elseif ($Duration.TotalMinutes -ge 1) {
        return "$($Duration.Minutes)m $($Duration.Seconds)s"
    } else {
        return "$($Duration.Seconds).$([math]::Floor($Duration.Milliseconds / 100))s"
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

# ========================================
# 主程序
# ========================================
Clear-Host
Start-BuildTimer

Write-Header "Tauri Desktop Build Script v$SCRIPT_VERSION"

$buildStartTime = Get-Date
Write-Host "Build started: $($buildStartTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Gray
Write-Host ""

# ========================================
# 阶段 0: 环境检查
# ========================================
$stage0 = Start-Stage "Environment Check"
Write-Stage 0 4 "Checking environment..."

if (-not (Test-Path "src-tauri")) {
    Write-Error "Not in project root directory"
    exit 1
}

# 检查 Rust
$rustVersion = rustc --version 2>$null
if (-not $rustVersion) {
    Write-Error "Rust not found in PATH"
    exit 1
}
Write-Success "Rust: $rustVersion"

# 检查 Bun
$bunVersion = bun --version 2>$null
if (-not $bunVersion) {
    Write-Error "Bun not found in PATH"
    exit 1
}
Write-Success "Bun: $bunVersion"
Stop-Stage $stage0 | Out-Null

# ========================================
# 阶段 1: 清理
# ========================================
$stage1 = Start-Stage "Cleanup"
Write-Stage 1 4 "Cleaning old builds..."

if (Test-Path "src-tauri/target") {
    Remove-Item -Recurse -Force "src-tauri/target" -ErrorAction SilentlyContinue
    Write-Success "Cleaned target directory"
}

if ($Clean) {
    if (Test-Path "dist") {
        Remove-Item -Recurse -Force "dist" -ErrorAction SilentlyContinue
        Write-Info "Cleaned dist directory"
    }
    if (Test-Path "node_modules") {
        Write-Info "Skipped node_modules (use 'bun install' to refresh)"
    }
}
Stop-Stage $stage1 | Out-Null

# ========================================
# 阶段 2: 依赖安装
# ========================================
$stage2 = Start-Stage "Dependencies"
Write-Stage 2 4 "Installing dependencies..."

try {
    bun install | Out-Null
    Write-Success "Dependencies installed"
} catch {
    Write-Error "Failed to install dependencies: $_"
    exit 1
}
Stop-Stage $stage2 | Out-Null

# ========================================
# 阶段 3: 构建
# ========================================
$stage3 = Start-Stage "Build"
Write-Stage 3 4 "Building application..."

try {
    # 前端构建
    Write-Host "  Building frontend..." -ForegroundColor DarkGray
    bun run build | Out-Null

    # Tauri 构建
    Write-Host "  Building Tauri app..." -ForegroundColor DarkGray
    bun run tauri build | Out-Null

    Write-Success "Build completed"
} catch {
    Write-Error "Build failed: $_"
    exit 1
}
Stop-Stage $stage3 | Out-Null

# ========================================
# 构建完成统计
# ========================================
$totalTime = Stop-BuildTimer
$buildEndTime = Get-Date

Write-Header "Build Statistics" "Green"

# 阶段耗时
Write-Host "Stage Timings:" -ForegroundColor Cyan
Write-Host "----------------------------------------"

foreach ($stage in $Global:StageTimers) {
    $duration = $stage.Duration
    $barLength = [math]::Min([math]::Floor($duration.TotalSeconds / 3), 25)
    $bar = "█" * $barLength
    $timeStr = Format-Duration $duration
    Write-Host "  $($stage.Name.PadRight(20)) $bar $timeStr"
}

Write-Host "----------------------------------------"
Write-Host "  TOTAL".PadRight(20) -NoNewline
Write-Host ("█" * [math]::Min([math]::Floor($totalTime.TotalSeconds / 3), 25)) -NoNewline -ForegroundColor Green
Write-Host " $(Format-Duration $totalTime)" -ForegroundColor Green

Write-Host ""
Write-Host "Time Info:" -ForegroundColor Cyan
Write-Host "  Started:  $($buildStartTime.ToString('HH:mm:ss'))"
Write-Host "  Finished: $($buildEndTime.ToString('HH:mm:ss'))"
Write-Host "  Date:     $($buildStartTime.ToString('yyyy-MM-dd'))"

# ========================================
# 输出文件
# ========================================
Write-Host ""
Write-Host "Output Files:" -ForegroundColor Cyan

$bundleDir = "src-tauri/target/release/bundle"
$foundFiles = @()

if (Test-Path $bundleDir) {
    # MSI
    $msiFiles = Get-ChildItem -Path "$bundleDir/msi" -Filter "*.msi" -ErrorAction SilentlyContinue
    foreach ($f in $msiFiles) {
        $sizeMB = [math]::Round($f.Length / 1MB, 2)
        Write-Host "  [MSI] $($f.Name)" -ForegroundColor White
        Write-Host "        Size: $sizeMB MB"
        Write-Host "        Path: $($f.FullName)"
        $foundFiles += $f
        Write-Host ""
    }

    # NSIS
    $nsisFiles = Get-ChildItem -Path "$bundleDir/nsis" -Filter "*.exe" -ErrorAction SilentlyContinue
    foreach ($f in $nsisFiles) {
        $sizeMB = [math]::Round($f.Length / 1MB, 2)
        Write-Host "  [NSIS] $($f.Name)" -ForegroundColor White
        Write-Host "         Size: $sizeMB MB"
        Write-Host "         Path: $($f.FullName)"
        $foundFiles += $f
        Write-Host ""
    }
}

if ($foundFiles.Count -eq 0) {
    Write-Warning "No output files found"
}

# ========================================
# 保存日志
# ========================================
$logDir = "build-logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$logFile = "$logDir/desktop-build-$($buildStartTime.ToString('yyyyMMdd-HHmmss')).log"
$logContent = @"
Tauri Desktop Build Log
=======================
Build Date: $($buildStartTime.ToString('yyyy-MM-dd HH:mm:ss'))
Duration: $(Format-Duration $totalTime)
Rust: $rustVersion
Bun: $bunVersion

Stage Timings:
$($Global:StageTimers | ForEach-Object { "  $($_.Name): $(Format-Duration $_.Duration)" } | Out-String)

Output Files:
$($foundFiles | ForEach-Object { "  $($_.FullName) ($([math]::Round($_.Length / 1MB, 2)) MB)" } | Out-String)
"@

$logContent | Out-File -FilePath $logFile -Encoding UTF8
Write-Info "Build log saved: $logFile"

# ========================================
# 完成
# ========================================
Write-Header "Build Complete!" "Green"

# 提示音
[console]::beep(800, 200)
Start-Sleep -Milliseconds 100
[console]::beep(1000, 300)

pause
