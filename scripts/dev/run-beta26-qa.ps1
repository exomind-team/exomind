[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  [Parameter()]
  [string]$InstanceRoot = (Join-Path $env:LOCALAPPDATA 'ExoMind\Beta26-QA')
)

$ErrorActionPreference = 'Stop'

$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$file = Get-Item -LiteralPath $executable
$version = $file.VersionInfo.ProductVersion
if ($version -notlike '0.6.0-beta26*') {
  throw "Expected a Beta26 executable; found ProductVersion '$version'."
}

$instanceRootFull = [System.IO.Path]::GetFullPath($InstanceRoot)
$betaDataRoot = [System.IO.Path]::GetFullPath((Join-Path $instanceRootFull 'beta-host'))
$defaultBetaAppData = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA 'com.exomind.app.v06.beta'))
$defaultBetaRoot = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA 'com.exomind.app.v06.beta\beta-host'))
function Test-PathOverlap([string]$Left, [string]$Right) {
  $leftFull = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
  $rightFull = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
  $leftBoundary = $leftFull + '\'
  $rightBoundary = $rightFull + '\'
  return [string]::Equals($leftFull, $rightFull, [System.StringComparison]::OrdinalIgnoreCase) -or
    $leftFull.StartsWith($rightBoundary, [System.StringComparison]::OrdinalIgnoreCase) -or
    $rightFull.StartsWith($leftBoundary, [System.StringComparison]::OrdinalIgnoreCase)
}
if ((Test-PathOverlap $instanceRootFull $defaultBetaAppData) -or (Test-PathOverlap $betaDataRoot $defaultBetaRoot)) {
  throw 'The QA data root overlaps the shared Beta profile root; choose a separate InstanceRoot.'
}

$overrides = [ordered]@{
  EXOMIND_BETA_DATA_DIR = $betaDataRoot
  EXOMIND_DEV_APP_DATA_DIR = Join-Path $instanceRootFull 'app-data'
  EXOMIND_DEV_LOG_DIR = Join-Path $instanceRootFull 'logs'
  EXOMIND_DEV_WEBVIEW_MAIN_DATA_DIR = Join-Path $instanceRootFull 'webview-main'
  EXOMIND_DEV_WEBVIEW_OVERLAY_DATA_ROOT = Join-Path $instanceRootFull 'webview-overlays'
}
$previous = @{}
$process = $null
foreach ($name in $overrides.Keys) {
  $previous[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
  foreach ($name in $overrides.Keys) {
    [System.Environment]::SetEnvironmentVariable($name, $overrides[$name], 'Process')
  }
  $process = Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable) -PassThru
} finally {
  foreach ($name in $overrides.Keys) {
    [System.Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
  }
}

[pscustomobject]@{
  ProcessId = $process.Id
  ExecutablePath = $executable
  ProductVersion = $version
  IsolatedDataRoot = $instanceRootFull
}
