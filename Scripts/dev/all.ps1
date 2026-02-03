param([switch]$OnlyDesktop, [switch]$OnlyAndroid)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/../_shared/config.ps1"

Clear-Host
Write-Header 'ExoMind Dev Commands'

if (-not $OnlyAndroid) {
    Write-Host '=== Desktop Dev ===' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Cmd: .\dev\desktop.ps1'
    Write-Host '  Or:  bun run tauri dev'
    Write-Host ''
    Write-Host '  Features:' -ForegroundColor Gray
    Write-Host '    - Local run, no device needed'
    Write-Host '    - Frontend hot reload'
    Write-Host '    - Rust changes need restart'
    Write-Host ''
}

if (-not $OnlyDesktop) {
    Write-Host '=== Android Dev ===' -ForegroundColor Green
    Write-Host ''
    Write-Host '  Cmd: .\dev\android.ps1'
    Write-Host '  Or:  bun run tauri android dev'
    Write-Host ''
    Write-Host '  Features:' -ForegroundColor Gray
    Write-Host '    - Need connected device/emulator'
    Write-Host '    - Frontend hot reload'
    Write-Host '    - HMR supported'
    Write-Host '    - Device disconnect needs restart'
    Write-Host ''
}

Write-Host 'Note:' -ForegroundColor Yellow
Write-Host '  Desktop and Android need separate terminals' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Shortcuts:' -ForegroundColor Cyan
Write-Host '  Desktop: cd Scripts; .\dev\desktop.ps1'
Write-Host '  Android: cd Scripts; .\dev\android.ps1'
Write-Host ''
