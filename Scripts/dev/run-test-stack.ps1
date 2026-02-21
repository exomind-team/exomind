<#
.SYNOPSIS
    启动联调栈（后端同步服务 + 前端开发服务）
.DESCRIPTION
    只通过环境变量配置端口与地址，不会修改或结束任何现有进程。
    若检测到端口被占用，会直接报错退出。

    支持环境变量：
      EXOMIND_WEB_PORT
      EXOMIND_HMR_PORT
      EXOMIND_POUCHDB_PORT
      EXOMIND_POUCHDB_HOST
      VITE_SYNC_SERVER_URL
      EXOMIND_SYNC_HOST

    默认值（仅当环境变量缺失）：
      WEB=1720
      HMR=1721
      POUCH=7284
      POUCH_HOST=127.0.0.1
      SYNC_HOST=localhost
.PARAMETER NoInstall
    跳过依赖检查
.PARAMETER DryRun
    只打印计划命令，不真正启动
#>
param(
    [switch]$NoInstall,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/../_shared/config.ps1"

function Get-EnvOrDefault {
    param(
        [string]$Name,
        [string]$Default
    )
    $val = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($val)) {
        return $Default
    }
    return $val.Trim()
}

function Parse-PortOrDefault {
    param(
        [string]$Name,
        [int]$Default
    )

    $raw = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $Default
    }

    $port = 0
    if (-not [int]::TryParse($raw, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        throw "Invalid port in environment variable ${Name}: ${raw}"
    }

    return $port
}

function Test-PortAvailable {
    param([int]$Port)

    $matches = netstat -ano | Select-String ":$Port\s+.*LISTENING"
    return ($null -eq $matches)
}

Write-Header 'ExoMind Local Test Stack'

Set-Location $Global:EMConfig.ProjectRoot
Test-ProjectRoot
Test-Bun | Out-Null

if (-not $NoInstall) {
    $nodeModules = Join-Path $Global:EMConfig.ProjectRoot 'node_modules'
    if (-not (Test-Path $nodeModules)) {
        Write-Stage 1 2 'Installing dependencies (bun install)...'
        bun install
    } else {
        Write-Info 'Dependencies already installed'
    }
}

$webPort = Parse-PortOrDefault -Name 'EXOMIND_WEB_PORT' -Default 1720
$hmrPort = Parse-PortOrDefault -Name 'EXOMIND_HMR_PORT' -Default ($webPort + 1)
$pouchPort = Parse-PortOrDefault -Name 'EXOMIND_POUCHDB_PORT' -Default 7284
$pouchHost = Get-EnvOrDefault -Name 'EXOMIND_POUCHDB_HOST' -Default '127.0.0.1'
$syncHost = Get-EnvOrDefault -Name 'EXOMIND_SYNC_HOST' -Default 'localhost'
$syncUrl = Get-EnvOrDefault -Name 'VITE_SYNC_SERVER_URL' -Default "http://$syncHost`:$pouchPort"

foreach ($port in @($webPort, $hmrPort, $pouchPort)) {
    if (-not (Test-PortAvailable -Port $port)) {
        throw "Port $port is already in use. Please set environment variables to unused ports."
    }
}

$backendCmd = "Set-Location '$($Global:EMConfig.ProjectRoot)'; " +
    "`$env:EXOMIND_POUCHDB_PORT='$pouchPort'; " +
    "`$env:EXOMIND_POUCHDB_HOST='$pouchHost'; " +
    "bun run server"

$frontendCmd = "Set-Location '$($Global:EMConfig.ProjectRoot)'; " +
    "`$env:EXOMIND_WEB_PORT='$webPort'; " +
    "`$env:EXOMIND_HMR_PORT='$hmrPort'; " +
    "`$env:VITE_SYNC_SERVER_URL='$syncUrl'; " +
    "bun run dev -- --host 0.0.0.0"

Write-Host ''
Write-Host 'Planned commands:' -ForegroundColor Cyan
Write-Host "  Backend : $backendCmd" -ForegroundColor Gray
Write-Host "  Frontend: $frontendCmd" -ForegroundColor Gray
Write-Host ''

if ($DryRun) {
    Write-Warning 'DryRun enabled: no process started'
    return
}

Write-Stage 1 2 'Starting backend sync server terminal...'
Start-Process powershell -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command', $backendCmd
) | Out-Null

Start-Sleep -Seconds 1

Write-Stage 2 2 'Starting frontend dev server terminal...'
Start-Process powershell -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command', $frontendCmd
) | Out-Null

Write-Host ''
Write-Success "Frontend URL: http://localhost:$webPort"
Write-Success "Sync URL:     $syncUrl"
Write-Info 'This script does not stop or replace existing services.'
