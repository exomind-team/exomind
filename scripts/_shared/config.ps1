# ExoMind 脚本共享配置
# 所有脚本共享的环境配置和工具函数

$ErrorActionPreference = "Stop"

# ========================================
# 全局配置
# ========================================
$Global:EMConfig = @{
    # Java 17 路径
    Java17 = "D:\data\AndroidStudioSDK\java17"

    # Android SDK 路径
    AndroidSdk = "D:\data\AndroidStudioSDK"

    # 脚本版本
    ScriptVersion = "3.0"

    # 项目根目录（相对于脚本位置的父目录）
    ProjectRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
}

# ========================================
# 计时器函数
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

function Write-Warning {
    param([string]$Text)
    Write-Host "  [WARN] $Text" -ForegroundColor Yellow
}

# ========================================
# 环境检查函数
# ========================================
function Test-ProjectRoot {
    $tauriPath = Join-Path $Global:EMConfig.ProjectRoot "src-tauri"
    if (-not (Test-Path $tauriPath)) {
        Write-Error "Not in project root directory (src-tauri not found)"
        exit 1
    }
}

function Test-Rust {
    $rustVersion = rustc --version 2>$null
    if (-not $rustVersion) {
        Write-Error "Rust not found in PATH"
        exit 1
    }
    Write-Success "Rust: $rustVersion"
    return $rustVersion
}

function Test-Bun {
    $bunVersion = bun --version 2>$null
    if (-not $bunVersion) {
        Write-Error "Bun not found in PATH"
        exit 1
    }
    Write-Success "Bun: $bunVersion"
    return $bunVersion
}

function Set-JavaEnvironment {
    $javaPath = $Global:EMConfig.Java17
    if (Test-Path $javaPath) {
        $env:JAVA_HOME = $javaPath
        $env:PATH = "$javaPath\bin;$env:PATH"
        $env:ANDROID_HOME = $Global:EMConfig.AndroidSdk

        $javaVer = java -version 2>&1 | Select-String "version" | ForEach-Object { ($_ -split '"')[1] }
        Write-Success "Java: $javaVer"
    } else {
        Write-Warning "Java 17 not found at $javaPath"
    }
}

function Test-ADB {
    $adbPath = "$($Global:EMConfig.AndroidSdk)\platform-tools\adb.exe"
    if (-not (Test-Path $adbPath)) {
        Write-Error "ADB not found at $adbPath"
        exit 1
    }
    return $adbPath
}

function Sync-AndroidLauncherIcons {
    param(
        [string]$ProjectRoot = $Global:EMConfig.ProjectRoot
    )

    # Android generated project resource path (Android 生成工程资源目录)
    $androidResPath = Join-Path $ProjectRoot "src-tauri\gen\android\app\src\main\res"
    if (-not (Test-Path $androidResPath)) {
        Write-Warning "Android project not initialized, skip icon sync"
        return
    }

    # Prefer app-icon.png, fallback to icons/icon.png (优先 app-icon.png，兜底 icons/icon.png)
    $sourceIcon = Join-Path $ProjectRoot "src-tauri\app-icon.png"
    if (-not (Test-Path $sourceIcon)) {
        $fallbackIcon = Join-Path $ProjectRoot "src-tauri\icons\icon.png"
        if (Test-Path $fallbackIcon) {
            $sourceIcon = $fallbackIcon
        }
        else {
            Write-Warning "No source icon found, skip Android icon sync"
            return
        }
    }

    $tempDir = Join-Path $env:TEMP ("exomind-tauri-icon-sync-{0}" -f [Guid]::NewGuid().ToString("N"))

    try {
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

        # Generate platform launcher icons (生成平台图标)
        & tauri icon $sourceIcon -o $tempDir | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "tauri icon exited with code $LASTEXITCODE"
        }

        $generatedAndroid = Join-Path $tempDir "android"
        if (-not (Test-Path $generatedAndroid)) {
            throw "Generated android icon directory not found: $generatedAndroid"
        }

        $copiedCount = 0
        Get-ChildItem -Path $generatedAndroid -Directory -Filter "mipmap-*" | ForEach-Object {
            $targetDir = Join-Path $androidResPath $_.Name
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

            Get-ChildItem -Path $_.FullName -File -Filter "ic_launcher*.png" | ForEach-Object {
                Copy-Item -Path $_.FullName -Destination (Join-Path $targetDir $_.Name) -Force
                $copiedCount++
            }
        }

        if ($copiedCount -gt 0) {
            Write-Success "Android launcher icons synced ($copiedCount files)"
        }
        else {
            Write-Warning "Android icon sync completed with no launcher files copied"
        }
    }
    catch {
        Write-Warning "Failed to sync Android launcher icons: $_"
        throw
    }
    finally {
        if (Test-Path $tempDir) {
            Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
        }
    }
}

function Get-AndroidDevices {
    $adbPath = Test-ADB
    $devices = & $adbPath devices | Select-String "device$" | Where-Object { $_ -notmatch "List of devices attached" }
    return $devices
}

# ========================================
# 日志函数
# ========================================
function Save-BuildLog {
    param(
        [string]$Type,
        [DateTime]$StartTime,
        [TimeSpan]$Duration,
        [array]$OutputFiles = @()
    )

    $logDir = Join-Path $Global:EMConfig.ProjectRoot "build-logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir | Out-Null
    }

    $logFile = "$logDir/$Type-build-$($StartTime.ToString('yyyyMMdd-HHmmss')).log"

    $logContent = @"
ExoMind $Type Build Log
=======================
Build Date: $($StartTime.ToString('yyyy-MM-dd HH:mm:ss'))
Duration: $(Format-Duration $Duration)

Stage Timings:
$($Global:StageTimers | ForEach-Object { "  $($_.Name): $(Format-Duration $_.Duration)" } | Out-String)

Output Files:
$($OutputFiles | ForEach-Object { "  $($_.FullName) ($([math]::Round($_.Length / 1MB, 2)) MB)" } | Out-String)
"@

    $logContent | Out-File -FilePath $logFile -Encoding UTF8
    Write-Info "Build log saved: $logFile"
}

# ========================================
# 完成提示
# ========================================
function Invoke-CompletionBeep {
    [console]::beep(800, 200)
    Start-Sleep -Milliseconds 100
    [console]::beep(1000, 300)
}
