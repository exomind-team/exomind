# scripts/build-desktop.ps1
param(
    [switch]$Release = $false
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host "Building ExoMind Desktop..." -ForegroundColor Cyan

Push-Location $projectRoot
try {
    if ($Release) {
        bun tauri build
    } else {
        bun tauri build --debug
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Desktop build failed!"
        exit 1
    }
}
finally {
    Pop-Location
}

Write-Host "Desktop build complete!" -ForegroundColor Green
Write-Host "Output: $projectRoot\src-tauri\target\release\exomind.exe" -ForegroundColor Green
