# Ensure Android manifest microphone permissions (确保 Android 清单包含麦克风权限)
# Use built-in $args for CI compatibility (使用内置 $args 以兼容 CI)
$TauriArgs = @($args)

$ErrorActionPreference = "Stop"

function Write-TextUtf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  # PowerShell 5.1 does not support UTF8NoBOM in Set-Content.
  #（PowerShell 5.1 不支持 Set-Content 的 UTF8NoBOM）
  if ($PSVersionTable.PSVersion.Major -ge 6) {
    Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8NoBOM
    return
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Ensure-CargoFromRustup {
  # Guard: if cargo already available, keep existing behavior.
  #（若 PATH 已有 cargo，保持原行为）
  if (Get-Command cargo -ErrorAction SilentlyContinue) {
    return
  }

  $rustupCommand = Get-Command rustup -ErrorAction SilentlyContinue
  if (-not $rustupCommand) {
    return
  }

  $cargoPath = ""
  try {
    $cargoPath = (& $rustupCommand.Source which cargo 2>$null | Select-Object -First 1)
  } catch {
    return
  }

  if ([string]::IsNullOrWhiteSpace($cargoPath)) {
    return
  }

  $cargoPath = $cargoPath.Trim()
  if (-not (Test-Path -LiteralPath $cargoPath)) {
    return
  }

  $cargoBinDir = Split-Path -Parent $cargoPath
  if ([string]::IsNullOrWhiteSpace($cargoBinDir)) {
    return
  }

  $pathEntries = @($env:PATH -split ';')
  if ($pathEntries -contains $cargoBinDir) {
    return
  }

  $env:PATH = "$cargoBinDir;$env:PATH"
  Write-Host "[tauri-wrapper] Added cargo path from rustup: $cargoBinDir"
}

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
    "getByName(`"release`") {`r`n            // LAN debug first（局域网调试优先）: allow HTTP sync in release for now`r`n            $targetLine",
    1
  )

  if ($updated -ne $content) {
    Write-TextUtf8NoBom -Path $BuildGradlePath -Content $updated
    Write-Host "[tauri-wrapper] Enabled release cleartext traffic in Android build.gradle.kts"
  }
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

# Resolve a free dev port for Vite when not explicitly configured.
# (未显式配置端口时，自动寻找空闲端口)
function Resolve-FreeDevPort {
  if ($env:EXOMIND_WEB_PORT) {
    return
  }

  $scriptPath = Join-Path $PSScriptRoot "find-free-port.ts"
  if (-not (Test-Path -LiteralPath $scriptPath)) {
    return
  }

  try {
    $port = (& bun $scriptPath 1420 2>$null).Trim()
    if ($port -and $port -match '^\d+$') {
      $env:EXOMIND_WEB_PORT = $port
      $hmr = [int]$port + 1
      if ($hmr -le 65535) {
        $env:EXOMIND_HMR_PORT = "$hmr"
      }
      Write-Host "[tauri-wrapper] Dev port resolved: $port (HMR: $hmr)"
    }
  } catch {
    Write-Warning "[tauri-wrapper] Failed to resolve free port: $_"
  }
}

$projectRoot = Join-Path $PSScriptRoot "..\..\"
$projectRoot = [System.IO.Path]::GetFullPath($projectRoot)
$manifestPath = Join-Path $PSScriptRoot "..\..\src-tauri\gen\android\app\src\main\AndroidManifest.xml"
$manifestPath = [System.IO.Path]::GetFullPath($manifestPath)
$buildGradlePath = Join-Path $PSScriptRoot "..\..\src-tauri\gen\android\app\build.gradle.kts"
$buildGradlePath = [System.IO.Path]::GetFullPath($buildGradlePath)

# Patch before command for existing Android project (已有工程先补权限与 cleartext 配置)
Ensure-AndroidManifestPermissions -ManifestPath $manifestPath
Ensure-AndroidReleaseCleartextTraffic -BuildGradlePath $buildGradlePath

# Ensure cargo is resolvable even when rustup shim is partial.
#（兼容仅安装 rustup、但 PATH 缺少 cargo 代理的环境）
Ensure-CargoFromRustup

# Resolve free dev port for `tauri dev` (为 tauri dev 自动寻找空闲端口)
$isTauriDev = $TauriArgs -and $TauriArgs.Count -ge 1 -and $TauriArgs[0] -eq "dev"
if ($isTauriDev) {
  Resolve-FreeDevPort
}

# Sync launcher icons before android build/dev/run/init (构建前同步 Android 图标)
$androidCommandsNeedIconSync = @("build", "dev", "run", "init")
if ($TauriArgs -and $TauriArgs.Count -ge 2 -and $TauriArgs[0] -eq "android" -and ($androidCommandsNeedIconSync -contains $TauriArgs[1])) {
  Ensure-AndroidLauncherIcons -ProjectRoot $projectRoot
}

# Run tauri CLI (执行 tauri 命令)
$exitCode = 0
$tempConfigPath = $null
if ($TauriArgs -and $TauriArgs.Count -gt 0) {
  # Inject --config to override devUrl when port differs from default
  # (端口非默认值时，通过 --config 覆盖 devUrl)
  if ($isTauriDev -and $env:EXOMIND_WEB_PORT -and $env:EXOMIND_WEB_PORT -ne "1420") {
    $tempConfigPath = Join-Path $env:TEMP ("exomind-tauri-dev-config-{0}.json" -f [Guid]::NewGuid().ToString("N"))
    $devUrlOverride = '{"build":{"devUrl":"http://localhost:' + $env:EXOMIND_WEB_PORT + '"}}'
    Write-TextUtf8NoBom -Path $tempConfigPath -Content $devUrlOverride
    & tauri @TauriArgs --config $tempConfigPath
  } else {
    & tauri @TauriArgs
  }
} else {
  & tauri
}
$exitCode = $LASTEXITCODE

if ($tempConfigPath -and (Test-Path -LiteralPath $tempConfigPath)) {
  Remove-Item -LiteralPath $tempConfigPath -Force -ErrorAction SilentlyContinue
}

# Patch again for `tauri android init`-like flows (初始化后再次补权限与 cleartext 配置)
if ($TauriArgs -and $TauriArgs.Count -ge 2 -and $TauriArgs[0] -eq "android") {
  Ensure-AndroidManifestPermissions -ManifestPath $manifestPath
  Ensure-AndroidReleaseCleartextTraffic -BuildGradlePath $buildGradlePath
  if ($androidCommandsNeedIconSync -contains $TauriArgs[1]) {
    Ensure-AndroidLauncherIcons -ProjectRoot $projectRoot
  }
}

exit $exitCode
