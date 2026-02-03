<#
.SYNOPSIS
    Windows 桌面端构建脚本

.DESCRIPTION
    构建 Windows 桌面端应用，生成 MSI 和 NSIS 安装包

.PARAMETER Clean
    深度清理（包括 dist 目录）

.PARAMETER Target
    构建目标: msi, nsis, 或 all
#>
param(
    [switch]$Clean,
    [string]$Target = "all"
)

$ErrorActionPreference = "Stop"

# 导入共享配置
. "$PSScriptRoot/../_shared/config.ps1"

Clear-Host
Start-BuildTimer

Write-Header "ExoMind 桌面端构建脚本 v$($Global:EMConfig.ScriptVersion)"

$buildStartTime = Get-Date
Write-Info "Build started: $($buildStartTime.ToString('yyyy-MM-dd HH:mm:ss'))"

# 切换到项目根目录
Set-Location $Global:EMConfig.ProjectRoot

# ========================================
# 阶段 0: 环境检查
# ========================================
$stage0 = Start-Stage "Environment Check"
Write-Stage 0 4 "Checking environment..."

Test-ProjectRoot
$rustVersion = Test-Rust
$bunVersion = Test-Bun

Stop-Stage $stage0 | Out-Null

# ========================================
# 阶段 1: 清理
# ========================================
$stage1 = Start-Stage "Cleanup"
Write-Stage 1 4 "Cleaning old builds..."

$targetPath = Join-Path $Global:EMConfig.ProjectRoot "src-tauri\target"
if (Test-Path $targetPath) {
    Remove-Item -Recurse -Force $targetPath -ErrorAction SilentlyContinue
    Write-Success "Cleaned target directory"
}

if ($Clean) {
    $distPath = Join-Path $Global:EMConfig.ProjectRoot "dist"
    if (Test-Path $distPath) {
        Remove-Item -Recurse -Force $distPath -ErrorAction SilentlyContinue
        Write-Info "Cleaned dist directory"
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

$bundleDir = Join-Path $Global:EMConfig.ProjectRoot "src-tauri\target\release\bundle"
$foundFiles = @()

if (Test-Path $bundleDir) {
    # MSI
    $msiFiles = Get-ChildItem -Path "$bundleDir\msi" -Filter "*.msi" -ErrorAction SilentlyContinue
    foreach ($f in $msiFiles) {
        $sizeMB = [math]::Round($f.Length / 1MB, 2)
        Write-Host "  [MSI] $($f.Name)" -ForegroundColor White
        Write-Host "        Size: $sizeMB MB"
        Write-Host "        Path: $($f.FullName)"
        $foundFiles += $f
        Write-Host ""
    }

    # NSIS
    $nsisFiles = Get-ChildItem -Path "$bundleDir\nsis" -Filter "*.exe" -ErrorAction SilentlyContinue
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
Save-BuildLog -Type "desktop" -StartTime $buildStartTime -Duration $totalTime -OutputFiles $foundFiles

# ========================================
# 完成
# ========================================
Write-Header "Build Complete!" "Green"
Invoke-CompletionBeep
