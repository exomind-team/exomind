<#
.SYNOPSIS
    Desktop development mode
.DESCRIPTION
    Start desktop dev server with hot reload support
.PARAMETER NoInstall
    Skip dependency installation
#>
param([switch]$NoInstall)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/../_shared/config.ps1"

Clear-Host
Write-Header 'ExoMind Desktop Dev Mode'

Set-Location $Global:EMConfig.ProjectRoot

Test-ProjectRoot

if (-not $NoInstall) {
    $nodeModules = Join-Path $Global:EMConfig.ProjectRoot 'node_modules'
    if (-not (Test-Path $nodeModules)) {
        Write-Host '[1/2] Installing dependencies...' -ForegroundColor Yellow
        bun install
    }
}

Write-Host ''
Write-Host '=== Starting Desktop Dev Server ===' -ForegroundColor Green
Write-Host ''
Write-Host 'Features:' -ForegroundColor Gray
Write-Host '  - Local run, no device needed'
Write-Host '  - Frontend hot reload (HMR)'
Write-Host '  - Rust changes require restart'
Write-Host ''
Write-Host 'Shortcuts:' -ForegroundColor Gray
Write-Host '  Ctrl+C - Stop server'
Write-Host ''

bun run tauri dev
