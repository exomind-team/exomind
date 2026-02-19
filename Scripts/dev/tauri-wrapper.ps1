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

function Ensure-AndroidLauncherIcons {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
  )

  # Android generated project resource path (Android 生成工程资源目录)
  $androidResPath = Join-Path $ProjectRoot "src-tauri\gen\android\app\src\main\res"
  if (-not (Test-Path -LiteralPath $androidResPath)) {
    return
  }

  # Prefer app-icon.png, fallback to icons/icon.png (优先 app-icon.png，兜底 icons/icon.png)
  $sourceIcon = Join-Path $ProjectRoot "src-tauri\app-icon.png"
  if (-not (Test-Path -LiteralPath $sourceIcon)) {
    $fallbackIcon = Join-Path $ProjectRoot "src-tauri\icons\icon.png"
    if (Test-Path -LiteralPath $fallbackIcon) {
      $sourceIcon = $fallbackIcon
    } else {
      Write-Warning "[tauri-wrapper] Skip icon sync: source icon not found."
      return
    }
  }

  $tempDir = Join-Path $env:TEMP ("exomind-tauri-icon-sync-{0}" -f [Guid]::NewGuid().ToString("N"))

  try {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    # Generate platform launcher icons (生成平台图标)
    & tauri icon $sourceIcon -o $tempDir | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "tauri icon exited with code $LASTEXITCODE"
    }

    $generatedAndroid = Join-Path $tempDir "android"
    if (-not (Test-Path -LiteralPath $generatedAndroid)) {
      throw "generated android icon directory not found: $generatedAndroid"
    }

    $copied = 0
    Get-ChildItem -Path $generatedAndroid -Directory -Filter "mipmap-*" | ForEach-Object {
      $targetDir = Join-Path $androidResPath $_.Name
      New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

      Get-ChildItem -Path $_.FullName -File -Filter "ic_launcher*.png" | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $targetDir $_.Name) -Force
        $copied++
      }
    }

    if ($copied -gt 0) {
      Write-Host "[tauri-wrapper] Synced Android launcher icons: $copied files"
    } else {
      Write-Warning "[tauri-wrapper] Icon sync produced no launcher files."
    }
  } catch {
    Write-Warning "[tauri-wrapper] Failed to sync Android launcher icons: $_"
  } finally {
    if (Test-Path -LiteralPath $tempDir) {
      Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

$projectRoot = Join-Path $PSScriptRoot "..\..\"
$projectRoot = [System.IO.Path]::GetFullPath($projectRoot)
$manifestPath = Join-Path $PSScriptRoot "..\..\src-tauri\gen\android\app\src\main\AndroidManifest.xml"
$manifestPath = [System.IO.Path]::GetFullPath($manifestPath)

# Patch before command for existing Android project (已有工程先补权限)
Ensure-AndroidManifestPermissions -ManifestPath $manifestPath

# Sync launcher icons before android build/dev/run/init (构建前同步 Android 图标)
$androidCommandsNeedIconSync = @("build", "dev", "run", "init")
if ($TauriArgs -and $TauriArgs.Count -ge 2 -and $TauriArgs[0] -eq "android" -and ($androidCommandsNeedIconSync -contains $TauriArgs[1])) {
  Ensure-AndroidLauncherIcons -ProjectRoot $projectRoot
}

# Run tauri CLI (执行 tauri 命令)
if ($TauriArgs -and $TauriArgs.Count -gt 0) {
  & tauri @TauriArgs
} else {
  & tauri
}
$exitCode = $LASTEXITCODE

# Patch again for `tauri android init`-like flows (初始化后再次补权限)
if ($TauriArgs -and $TauriArgs.Count -ge 2 -and $TauriArgs[0] -eq "android") {
  Ensure-AndroidManifestPermissions -ManifestPath $manifestPath
  if ($androidCommandsNeedIconSync -contains $TauriArgs[1]) {
    Ensure-AndroidLauncherIcons -ProjectRoot $projectRoot
  }
}

exit $exitCode
