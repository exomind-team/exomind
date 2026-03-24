<#
.SYNOPSIS
    Android development mode
.DESCRIPTION
    Start Android dev server with hot reload support
.PARAMETER NoInstall
    Skip dependency installation
.PARAMETER NoInstallApk
    Skip APK build and install
#>
param([switch]$NoInstall, [switch]$NoInstallApk)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/../_shared/config.ps1"

Clear-Host
Write-Header 'ExoMind Android Dev Mode'

Set-Location $Global:EMConfig.ProjectRoot

Test-ProjectRoot

Set-JavaEnvironment

$adbPath = Test-ADB

$devices = Get-AndroidDevices
if (-not $devices) {
    Write-Error 'No Android device connected. Please connect a device or start emulator.'
    exit 1
}

$targetDevice = ($devices -split '\s+')[0]
Write-Success "Detected device: $targetDevice"

if (-not $NoInstall) {
    $nodeModules = Join-Path $Global:EMConfig.ProjectRoot 'node_modules'
    if (-not (Test-Path $nodeModules)) {
        Write-Host '[1/2] Installing dependencies...' -ForegroundColor Yellow
        bun install
    }
}

Write-Host ''
Write-Host '=== Starting Android Dev Server ===' -ForegroundColor Green
Write-Host ''
Write-Host 'Features:' -ForegroundColor Gray
Write-Host '  - Need connected device/emulator'
Write-Host '  - Frontend hot reload (HMR)'
Write-Host '  - Device disconnect needs restart'
Write-Host ''
Write-Host 'Shortcuts:' -ForegroundColor Gray
Write-Host '  Ctrl+C - Stop server'
Write-Host ''

if ($NoInstallApk) {
    bun run tauri android dev
} else {
    Write-Host 'Building and installing APK...' -ForegroundColor Yellow
    bun run tauri android build --apk

    $apkPath = Join-Path $Global:EMConfig.ProjectRoot 'src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk'
    if (Test-Path $apkPath) {
        & $adbPath -s $targetDevice install -r $apkPath
        Write-Success 'APK installed'
    }

    Write-Host ''
    Write-Host 'Starting dev server...' -ForegroundColor Green
    bun run tauri android dev
}
