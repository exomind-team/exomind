# Tauri All Platforms Build Script v2
# Builds Desktop (MSI + NSIS) and Android with full timing statistics
# 用法: .\build-all-v2.ps1 [-SkipDesktop] [-SkipAndroid] [-InstallAndroid]

param(
    [switch]$SkipDesktop,      # 跳过桌面端构建
    [switch]$SkipAndroid,      # 跳过 Android 构建
    [switch]$InstallAndroid    # 构建后安装 Android APK
)

$ErrorActionPreference = "Stop"

# ========================================
# 配置
# ========================================
$SCRIPT_VERSION = "2.0"
$JAVA_17 = "D:\data\AndroidStudioSDK\java17"

# ========================================
# 计时器
# ========================================
$Global:TotalTimer = [System.Diagnostics.Stopwatch]::new()

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
# 主程序
# ========================================
Clear-Host
$Global:TotalTimer.Start()

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Tauri All Platforms Build v$SCRIPT_VERSION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$startTime = Get-Date
Write-Host "Build started: $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Gray
Write-Host ""

$results = @{
    Desktop = @{ Success = $false; Duration = $null; Files = @() }
    Android = @{ Success = $false; Duration = $null; Files = @() }
}

# ========================================
# 桌面端构建
# ========================================
if (-not $SkipDesktop) {
    Write-Host "[1/2] Building Desktop..." -ForegroundColor Magenta
    Write-Host ""

    $desktopTimer = [System.Diagnostics.Stopwatch]::new()
    $desktopTimer.Start()

    try {
        # 清理
        if (Test-Path "src-tauri/target") {
            Remove-Item -Recurse -Force "src-tauri/target" -ErrorAction SilentlyContinue
        }

        # 依赖
        Write-Host "  Installing dependencies..." -ForegroundColor DarkGray
        bun install | Out-Null

        # 构建
        Write-Host "  Building..." -ForegroundColor DarkGray
        bun run build | Out-Null
        bun run tauri build | Out-Null

        $desktopTimer.Stop()
        $results.Desktop.Success = $true
        $results.Desktop.Duration = $desktopTimer.Elapsed

        # 收集输出文件
        $bundleDir = "src-tauri/target/release/bundle"
        if (Test-Path $bundleDir) {
            $results.Desktop.Files += Get-ChildItem -Path "$bundleDir/msi" -Filter "*.msi" -ErrorAction SilentlyContinue
            $results.Desktop.Files += Get-ChildItem -Path "$bundleDir/nsis" -Filter "*.exe" -ErrorAction SilentlyContinue
        }

        Write-Host "  Desktop build completed in $(Format-Duration $desktopTimer.Elapsed)" -ForegroundColor Green
    } catch {
        $desktopTimer.Stop()
        Write-Host "  Desktop build failed: $_" -ForegroundColor Red
    }
    Write-Host ""
} else {
    Write-Host "[1/2] Desktop skipped (use -SkipDesktop to build)" -ForegroundColor Yellow
    Write-Host ""
}

# ========================================
# Android 构建
# ========================================
if (-not $SkipAndroid) {
    Write-Host "[2/2] Building Android..." -ForegroundColor Magenta
    Write-Host ""

    $androidTimer = [System.Diagnostics.Stopwatch]::new()
    $androidTimer.Start()

    # 设置 Java 17
    if (Test-Path $JAVA_17) {
        $env:JAVA_HOME = $JAVA_17
        $env:PATH = "$JAVA_17\bin;" + $env:PATH
        $jv = java -version 2>&1 | Select-String "version"
        Write-Host "  Java: $jv" -ForegroundColor DarkGray
    }

    try {
        # 清理 Android targets
        Remove-Item -Recurse -Force "src-tauri/target/aarch64-linux-android" -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force "src-tauri/target/armv7-linux-androideabi" -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force "src-tauri/target/i686-linux-android" -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force "src-tauri/target/x86_64-linux-android" -ErrorAction SilentlyContinue

        # 依赖
        Write-Host "  Installing dependencies..." -ForegroundColor DarkGray
        bun install | Out-Null

        # 构建
        Write-Host "  Building..." -ForegroundColor DarkGray
        bun run build | Out-Null
        bun run tauri android build --apk | Out-Null

        $androidTimer.Stop()
        $results.Android.Success = $true
        $results.Android.Duration = $androidTimer.Elapsed

        # 收集输出文件
        $apkDir = "src-tauri/gen/android/app/build/outputs/apk"
        if (Test-Path $apkDir) {
            $results.Android.Files += Get-ChildItem -Path $apkDir -Recurse -Filter "*.apk" -ErrorAction SilentlyContinue
        }

        Write-Host "  Android build completed in $(Format-Duration $androidTimer.Elapsed)" -ForegroundColor Green

        # 安装到设备
        if ($InstallAndroid -and $results.Android.Files.Count -gt 0) {
            Write-Host "  Installing to device..." -ForegroundColor DarkGray
            $mainApk = $results.Android.Files | Select-Object -First 1
            adb install -r $mainApk.FullName | Out-Null
            Write-Host "  Installed successfully" -ForegroundColor Green
        }
    } catch {
        $androidTimer.Stop()
        Write-Host "  Android build failed: $_" -ForegroundColor Red
    }
    Write-Host ""
} else {
    Write-Host "[2/2] Android skipped (use -SkipAndroid to build)" -ForegroundColor Yellow
    Write-Host ""
}

# ========================================
# 总统计
# ========================================
$Global:TotalTimer.Stop()
$totalDuration = $Global:TotalTimer.Elapsed
$endTime = Get-Date

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Build Summary" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

Write-Host "Timing Statistics:" -ForegroundColor Cyan
Write-Host "----------------------------------------"

if (-not $SkipDesktop) {
    $status = if ($results.Desktop.Success) { "✓ SUCCESS" } else { "✗ FAILED" }
    $color = if ($results.Desktop.Success) { "Green" } else { "Red" }
    Write-Host "  Desktop: $(Format-Duration $results.Desktop.Duration) " -NoNewline
    Write-Host $status -ForegroundColor $color
}

if (-not $SkipAndroid) {
    $status = if ($results.Android.Success) { "✓ SUCCESS" } else { "✗ FAILED" }
    $color = if ($results.Android.Success) { "Green" } else { "Red" }
    Write-Host "  Android: $(Format-Duration $results.Android.Duration) " -NoNewline
    Write-Host $status -ForegroundColor $color
}

Write-Host "----------------------------------------"
Write-Host "  TOTAL:   $(Format-Duration $totalDuration)" -ForegroundColor Yellow
Write-Host ""

Write-Host "Started:  $($startTime.ToString('HH:mm:ss'))" -ForegroundColor Gray
Write-Host "Finished: $($endTime.ToString('HH:mm:ss'))" -ForegroundColor Gray
Write-Host ""

# ========================================
# 输出文件列表
# ========================================
Write-Host "Output Files:" -ForegroundColor Cyan
Write-Host ""

$allFiles = @()

if ($results.Desktop.Files.Count -gt 0) {
    Write-Host "Desktop:" -ForegroundColor White
    foreach ($f in $results.Desktop.Files) {
        $sizeMB = [math]::Round($f.Length / 1MB, 2)
        Write-Host "  - $($f.Name) ($sizeMB MB)"
        $allFiles += $f
    }
    Write-Host ""
}

if ($results.Android.Files.Count -gt 0) {
    Write-Host "Android:" -ForegroundColor White
    foreach ($f in $results.Android.Files) {
        $sizeMB = [math]::Round($f.Length / 1MB, 2)
        Write-Host "  - $($f.Name) ($sizeMB MB)"
        $allFiles += $f
    }
    Write-Host ""
}

# ========================================
# 保存日志
# ========================================
$logDir = "build-logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$logFile = "$logDir/all-build-$($startTime.ToString('yyyyMMdd-HHmmss')).log"
@"
Tauri All Platforms Build Log
=============================
Build Date: $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))
Total Duration: $(Format-Duration $totalDuration)

Desktop: $(if ($results.Desktop.Success) { "SUCCESS ($(Format-Duration $results.Desktop.Duration))" } else { "FAILED" })
Android: $(if ($results.Android.Success) { "SUCCESS ($(Format-Duration $results.Android.Duration))" } else { "FAILED" })

Output Files:
$($allFiles | ForEach-Object { "  - $($_.FullName) ($([math]::Round($_.Length / 1MB, 2)) MB)" } | Out-String)
"@ | Out-File -FilePath $logFile -Encoding UTF8

Write-Host "Log saved: $logFile" -ForegroundColor DarkGray
Write-Host ""

# ========================================
# 完成
# ========================================
Write-Host "========================================" -ForegroundColor Green
Write-Host "  All Builds Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# 提示音
[console]::beep(800, 200)
Start-Sleep -Milliseconds 100
[console]::beep(1000, 200)
Start-Sleep -Milliseconds 100
[console]::beep(1200, 300)

pause
