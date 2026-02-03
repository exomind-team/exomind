# Tauri Android Auto Build & Install Script
# Full automation with timing, logging, and auto-install
# Requires: Java 17, Android SDK, connected device/emulator

param(
    [switch]$Release,    # Build release version (unsigned, needs signing)
    [switch]$NoInstall,  # Skip installation
    [string]$Device      # Specific device ID (default: auto-detect)
)

$ErrorActionPreference = "Stop"

# Configuration
$Config = @{
    Java17 = "D:\data\AndroidStudioSDK\java17"
    AndroidSdk = "D:\data\AndroidStudioSDK"
    ScriptVersion = "2.1"
}

# Initialize timer
$Timer = [System.Diagnostics.Stopwatch]::new()
$StageTimes = @()
$Timer.Start()

function Write-Section($Title, $Color = "Cyan") {
    Write-Host "`n========================================" -ForegroundColor $Color
    Write-Host "  $Title" -ForegroundColor $Color
    Write-Host "========================================" -ForegroundColor $Color
}

function Write-Step($Number, $Total, $Message) {
    Write-Host "[$Number/$Total] $Message" -ForegroundColor Yellow
}

function Write-Ok($Message) {
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Error($Message) {
    Write-Host "  [FAIL] $Message" -ForegroundColor Red
}

function Invoke-Stage($Name, $ScriptBlock) {
    $stageTimer = [System.Diagnostics.Stopwatch]::new()
    $stageTimer.Start()
    $result = & $ScriptBlock
    $stageTimer.Stop()
    $script:StageTimes += [PSCustomObject]@{ Name = $Name; Duration = $stageTimer.Elapsed }
    return $result
}

function Format-Time($TimeSpan) {
    if ($TimeSpan.TotalMinutes -ge 1) {
        return "$([math]::Floor($TimeSpan.TotalMinutes))m $($TimeSpan.Seconds)s"
    }
    return "$($TimeSpan.Seconds).$([math]::Floor($TimeSpan.Milliseconds / 100))s"
}

# Main
Clear-Host
Write-Section "Tauri Android Auto Build v$($Config.ScriptVersion)"

$StartTime = Get-Date
Write-Host "Started: $($StartTime.ToString('yyyy-MM-dd HH:mm:ss'))"

# Stage 0: Environment
Invoke-Stage "Environment" {
    Write-Step 0 5 "Setting up environment..."

    # Set Java 17
    $env:JAVA_HOME = $Config.Java17
    $env:PATH = "$($Config.Java17)\bin;$($env:PATH)"
    $env:ANDROID_HOME = $Config.AndroidSdk

    # Verify Java
    $javaVer = java -version 2>&1 | Select-String "version" | ForEach-Object { ($_ -split '"')[1] }
    Write-Ok "Java: $javaVer"

    # Check ADB
    $adbPath = "$($Config.AndroidSdk)\platform-tools\adb.exe"
    if (-not (Test-Path $adbPath)) {
        Write-Error "ADB not found"
        exit 1
    }

    # Check device
    if (-not $NoInstall) {
        if ($Device) {
            $script:TargetDevice = $Device
        } else {
            $devices = & $adbPath devices | Select-String "device$"
            if (-not $devices) {
                Write-Error "No device connected. Use -NoInstall to skip installation."
                exit 1
            }
            $script:TargetDevice = ($devices -split "\s+")[0]
        }
        Write-Ok "Target device: $TargetDevice"
    }
}

# Stage 1: Check
Invoke-Stage "Check" {
    Write-Step 1 5 "Checking project..."

    if (-not (Test-Path "src-tauri")) {
        Write-Error "Not in project root"
        exit 1
    }
    if (-not (Test-Path "src-tauri/gen/android")) {
        Write-Error "Android not initialized. Run: bun run tauri android init"
        exit 1
    }
    Write-Ok "Project OK"
}

# Stage 2: Clean
Invoke-Stage "Clean" {
    Write-Step 2 5 "Cleaning..."
    @("aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android") | ForEach-Object {
        $path = "src-tauri/target/$_"
        if (Test-Path $path) {
            Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
        }
    }
    Write-Ok "Cleaned target directories"
}

# Stage 3: Dependencies
Invoke-Stage "Dependencies" {
    Write-Step 3 5 "Installing dependencies..."
    bun install | Out-Null
    Write-Ok "Dependencies installed"
}

# Stage 4: Frontend
Invoke-Stage "Frontend" {
    Write-Step 4 5 "Building frontend..."
    bun run build | Out-Null
    Write-Ok "Frontend built"
}

# Stage 5: Android Build
Invoke-Stage "Android" {
    Write-Step 5 5 "Building Android APK..."
    Write-Host "  This may take 3-5 minutes..." -ForegroundColor Gray

    $buildType = if ($Release) { "release" } else { "debug" }
    Write-Host "  Build type: $buildType" -ForegroundColor Gray

    if ($Release) {
        bun run tauri android build --apk | Out-Null
    } else {
        # Debug build via gradle (avoids WebSocket issue)
        Set-Location src-tauri/gen/android
        ./gradlew assembleDebug --no-daemon -q | Out-Null
        Set-Location ../../..
    }
    Write-Ok "APK built"
}

# Find APK
$apkPath = if ($Release) {
    "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"
} else {
    "src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
}

if (-not (Test-Path $apkPath)) {
    # Try to find any APK
    $apk = Get-ChildItem -Path "src-tauri/gen/android" -Recurse -Filter "*.apk" | Select-Object -First 1
    if ($apk) {
        $apkPath = $apk.FullName
    } else {
        Write-Error "APK not found"
        exit 1
    }
}

# Sign if needed
if ($Release -and $apkPath -like "*unsigned*") {
    Write-Host "`n[Signing] Release APK needs signing..." -ForegroundColor Yellow
    $keystore = "my-release-key.jks"
    if (-not (Test-Path $keystore)) {
        Write-Host "  Creating keystore..." -ForegroundColor Gray
        & "$($Config.Java17)\bin\keytool.exe" -genkey -v -keystore $keystore -keyalg RSA -keysize 2048 -validity 10000 -alias tauri-app -storepass password -keypass password -dname "CN=Test, OU=Test, O=Test, L=Test, ST=Test, C=US" | Out-Null
    }
    $signedApk = $apkPath -replace "-unsigned", ""
    & "$($Config.AndroidSdk)\build-tools\36.1.0\apksigner.bat" sign --ks $keystore --ks-pass pass:password --key-pass pass:password $apkPath | Out-Null
    Write-Ok "APK signed"
}

$apkInfo = Get-Item $apkPath
$apkSizeMB = [math]::Round($apkInfo.Length / 1MB, 2)

# Install
if (-not $NoInstall) {
    Write-Host "`n[Installing] to $TargetDevice..." -ForegroundColor Yellow
    $adbPath = "$($Config.AndroidSdk)\platform-tools\adb.exe"
    & $adbPath -s $TargetDevice install -r $apkPath | Out-Null
    Write-Ok "Installed successfully"
}

# Summary
$Timer.Stop()
$EndTime = Get-Date

Write-Section "Build Summary" "Green"

Write-Host "`nStage Timings:" -ForegroundColor Cyan
Write-Host "----------------------------------------"
foreach ($stage in $StageTimes) {
    $bar = "█" * [math]::Min([math]::Floor($stage.Duration.TotalSeconds / 5), 20)
    Write-Host "  $($stage.Name.PadRight(15)) $bar $(Format-Time $stage.Duration)"
}
Write-Host "----------------------------------------"
Write-Host "  TOTAL".PadRight(15) -NoNewline
Write-Host ("█" * [math]::Min([math]::Floor($Timer.Elapsed.TotalSeconds / 5), 20)) -NoNewline -ForegroundColor Green
Write-Host " $(Format-Time $Timer.Elapsed)" -ForegroundColor Green

Write-Host "`nOutput:" -ForegroundColor Cyan
Write-Host "  File: $apkPath"
Write-Host "  Size: $apkSizeMB MB"
Write-Host "  Type: $(if ($Release) { "Release" } else { "Debug" })"

if (-not $NoInstall) {
    Write-Host "`nInstallation:" -ForegroundColor Cyan
    Write-Host "  Device: $TargetDevice"
    Write-Host "  Status: Success"
}

Write-Host "`nTime: $($StartTime.ToString('HH:mm:ss')) -> $($EndTime.ToString('HH:mm:ss'))" -ForegroundColor Gray

# Log
$logDir = "build-logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$logFile = "$logDir/auto-build-$($StartTime.ToString('yyyyMMdd-HHmmss')).log"
"Build: $($StartTime.ToString('yyyy-MM-dd HH:mm:ss'))`nDuration: $(Format-Time $Timer.Elapsed)`nAPK: $apkPath ($apkSizeMB MB)`nDevice: $TargetDevice" | Out-File $logFile
Write-Host "Log: $logFile" -ForegroundColor DarkGray

Write-Section "Completed!" "Green"
[console]::beep(800, 200)
Start-Sleep -Milliseconds 100
[console]::beep(1000, 300)
