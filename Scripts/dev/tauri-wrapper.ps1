# Ensure Android manifest microphone permissions (确保 Android 清单包含麦克风权限)
# Use built-in $args for CI compatibility (使用内置 $args 以兼容 CI)
$TauriArgs = @($args)

$ErrorActionPreference = "Stop"

function Ensure-AndroidManifestPermissions {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath
  )

  if (-not (Test-Path -LiteralPath $ManifestPath)) {
    return
  }

  [xml]$xml = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8
  $manifest = $xml.SelectSingleNode("/manifest")
  if (-not $manifest) {
    return
  }

  $requiredPermissions = @(
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS"
  )

  foreach ($permission in $requiredPermissions) {
    $exists = $false
    foreach ($node in @($manifest.SelectNodes("uses-permission"))) {
      $name = $node.GetAttribute("name", "http://schemas.android.com/apk/res/android")
      if ($name -eq $permission) {
        $exists = $true
        break
      }
    }

    if (-not $exists) {
      $newNode = $xml.CreateElement("uses-permission")
      $newNode.SetAttribute("name", "http://schemas.android.com/apk/res/android", $permission)
      [void]$manifest.PrependChild($newNode)
      Write-Host "[tauri-wrapper] Added permission: $permission"
    }
  }

  $settings = New-Object System.Xml.XmlWriterSettings
  $settings.Indent = $true
  $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
  $settings.OmitXmlDeclaration = $false

  $writer = [System.Xml.XmlWriter]::Create($ManifestPath, $settings)
  $xml.Save($writer)
  $writer.Dispose()
}

function Ensure-AndroidReleaseCleartextTraffic {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BuildGradlePath
  )

  if (-not (Test-Path -LiteralPath $BuildGradlePath)) {
    return
  }

  $content = Get-Content -LiteralPath $BuildGradlePath -Raw -Encoding UTF8
  $targetLine = 'manifestPlaceholders["usesCleartextTraffic"] = "true"'

  if ($content -match 'getByName\("release"\)\s*\{[\s\S]*manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"true"') {
    return
  }

  $updated = [regex]::Replace(
    $content,
    'getByName\("release"\)\s*\{',
    "getByName(`"release`") {`r`n            # LAN debug first（局域网调试优先）: allow HTTP sync in release for now`r`n            $targetLine",
    1
  )

  if ($updated -ne $content) {
    Set-Content -LiteralPath $BuildGradlePath -Value $updated -Encoding UTF8NoBOM
    Write-Host "[tauri-wrapper] Enabled release cleartext traffic in Android build.gradle.kts"
  }
}

$manifestPath = Join-Path $PSScriptRoot "..\..\src-tauri\gen\android\app\src\main\AndroidManifest.xml"
$manifestPath = [System.IO.Path]::GetFullPath($manifestPath)
$buildGradlePath = Join-Path $PSScriptRoot "..\..\src-tauri\gen\android\app\build.gradle.kts"
$buildGradlePath = [System.IO.Path]::GetFullPath($buildGradlePath)

# Patch before command for existing Android project (已有工程先补权限与 cleartext 配置)
Ensure-AndroidManifestPermissions -ManifestPath $manifestPath
Ensure-AndroidReleaseCleartextTraffic -BuildGradlePath $buildGradlePath

# Run tauri CLI (执行 tauri 命令)
if ($TauriArgs -and $TauriArgs.Count -gt 0) {
  & tauri @TauriArgs
} else {
  & tauri
}
$exitCode = $LASTEXITCODE

# Patch again for `tauri android init`-like flows (初始化后再次补权限与 cleartext 配置)
if ($TauriArgs -and $TauriArgs.Count -ge 2 -and $TauriArgs[0] -eq "android") {
  Ensure-AndroidManifestPermissions -ManifestPath $manifestPath
  Ensure-AndroidReleaseCleartextTraffic -BuildGradlePath $buildGradlePath
}

exit $exitCode
