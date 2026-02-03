# Tauri Android Build Script
# Auto-sets Java 17 environment

$ErrorActionPreference = "Stop"
$JAVA_17 = "D:\data\AndroidStudioSDK\java17"

# Check Java 17 exists
if (-not (Test-Path $JAVA_17)) {
    Write-Host "ERROR: Java 17 not found at: $JAVA_17" -ForegroundColor Red
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Tauri Android Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Set Java environment
$env:JAVA_HOME = $JAVA_17
$env:PATH = "$JAVA_17\bin;" + $env:PATH

# Verify Java version
$jv = java -version 2>&1 | Select-String "version"
Write-Host "Java: $jv" -ForegroundColor Green
Write-Host ""

# Check project
if (-not (Test-Path "src-tauri")) {
    Write-Host "ERROR: Run from project root" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "src-tauri/gen/android")) {
    Write-Host "ERROR: Android not initialized" -ForegroundColor Red
    Write-Host "Run: bun run tauri android init" -ForegroundColor Yellow
    exit 1
}

# Clean old builds
Write-Host "Cleaning old builds..." -ForegroundColor Yellow
Remove-Item -Recurse -Force "src-tauri/target/aarch64-linux-android" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "src-tauri/target/armv7-linux-androideabi" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "src-tauri/target/i686-linux-android" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "src-tauri/target/x86_64-linux-android" -ErrorAction SilentlyContinue
Write-Host "Done" -ForegroundColor Green
Write-Host ""

# Install deps
Write-Host "Installing dependencies..." -ForegroundColor Yellow
bun install
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "Done" -ForegroundColor Green
Write-Host ""

# Build frontend
Write-Host "Building frontend..." -ForegroundColor Yellow
bun run build
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "Done" -ForegroundColor Green
Write-Host ""

# Build Android
Write-Host "Building Android APK..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Gray
bun run tauri android build --apk
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Build Successful" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Find APK
$apkDir = "src-tauri/gen/android/app/build/outputs/apk"
Write-Host "APK files:" -ForegroundColor Cyan
Get-ChildItem -Path $apkDir -Recurse -Filter "*.apk" | ForEach-Object {
    $size = [math]::Round($_.Length / 1MB, 2)
    Write-Host "  $($_.FullName) (${sizeMB} MB)" -ForegroundColor White
}

Write-Host ""
Write-Host "Install to device:" -ForegroundColor Cyan
Write-Host "  adb install -r $apkDir\universal\release\app-universal-release-unsigned.apk" -ForegroundColor Gray
Write-Host ""
pause
