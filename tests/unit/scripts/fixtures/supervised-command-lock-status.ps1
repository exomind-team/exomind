param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference='Stop'
$statusPath=Join-Path $Directory 'status.json'
$owned=Get-Content -LiteralPath (Join-Path $Directory 'owner.json') -Raw | ConvertFrom-Json
if(-not $owned.runId){throw 'Missing owned fixture run'}
$stream=[IO.File]::Open($statusPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
try { Start-Sleep -Milliseconds 300 } finally { $stream.Dispose() }
