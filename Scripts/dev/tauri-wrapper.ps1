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

  $application = $manifest.SelectSingleNode("application")
  if ($application -and $application.GetAttribute("usesCleartextTraffic", "http://schemas.android.com/apk/res/android") -ne "true") {
    $application.SetAttribute("usesCleartextTraffic", "http://schemas.android.com/apk/res/android", "true")
    Write-Host "[tauri-wrapper] Enabled cleartext traffic in AndroidManifest.xml"
  }

  # Ensure configChanges on <activity> to prevent keyboard-connect crash
  $ns = "http://schemas.android.com/apk/res/android"
  $configChangesValue = "keyboard|keyboardHidden|navigation|orientation|screenSize|screenLayout|smallestScreenSize|uiMode|locale|layoutDirection|fontScale|density"
  $activity = $application.SelectSingleNode("activity")
  if (-not $activity) { $activity = $manifest.SelectSingleNode("//activity") }
  if ($activity -and $activity.GetAttribute("configChanges", $ns) -ne $configChangesValue) {
    $activity.SetAttribute("configChanges", $ns, $configChangesValue)
    Write-Host "[tauri-wrapper] Set configChanges on Activity in AndroidManifest.xml"
  }

  $requiredPermissions = @(
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.ACCESS_WIFI_STATE",
    "android.permission.CHANGE_WIFI_MULTICAST_STATE"
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

function Ensure-AndroidDebugCleartextTraffic {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BuildGradlePath
  )

  if (-not (Test-Path -LiteralPath $BuildGradlePath)) {
    return
  }

  $content = Get-Content -LiteralPath $BuildGradlePath -Raw -Encoding UTF8
  $targetLine = 'manifestPlaceholders["usesCleartextTraffic"] = "true"'
  $debugMatch = [regex]::Match($content, 'getByName\("debug"\)\s*\{')
  if (-not $debugMatch.Success) {
    return
  }

  $openBraceIndex = $debugMatch.Index + $debugMatch.Value.LastIndexOf('{')
  $depth = 0
  $closeBraceIndex = -1

  for ($index = $openBraceIndex; $index -lt $content.Length; $index++) {
    $char = $content[$index]
    if ($char -eq '{') {
      $depth++
      continue
    }
    if ($char -ne '}') {
      continue
    }

    $depth--
    if ($depth -eq 0) {
      $closeBraceIndex = $index
      break
    }
  }

  if ($closeBraceIndex -lt 0) {
    return
  }

  $debugBlock = $content.Substring($debugMatch.Index, $closeBraceIndex - $debugMatch.Index + 1)
  if ($debugBlock.Contains($targetLine)) {
    return
  }

  $updated = [regex]::Replace(
    $content,
    'getByName\("debug"\)\s*\{',
    "getByName(`"debug`") {`r`n            $targetLine",
    1
  )

  if ($updated -ne $content) {
    Write-TextUtf8NoBom -Path $BuildGradlePath -Content $updated
    Write-Host "[tauri-wrapper] Enabled debug cleartext traffic in Android build.gradle.kts"
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

function Invoke-AndroidGeneratedProjectPatch {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
  )

  $patchScriptPath = Join-Path $PSScriptRoot "android-manifest-permission.ts"
  if (-not (Test-Path -LiteralPath $patchScriptPath)) {
    Write-Warning "[tauri-wrapper] Android patch script not found: $patchScriptPath"
    return
  }

  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bunCommand) {
    Write-Warning "[tauri-wrapper] bun not found; skip Android generated project patch"
    return
  }

  try {
    & $bunCommand.Source $patchScriptPath
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "[tauri-wrapper] Android generated project patch exited with code $LASTEXITCODE"
    }
  } catch {
    Write-Warning "[tauri-wrapper] Failed to patch Android generated project: $_"
  }
}

function Test-PortAvailable {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Server.ExclusiveAddressUse = $true
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) {
      $listener.Stop()
    }
  }
}

function Resolve-EmbeddedRuntimePort {
  if ($env:EXOMIND_RT_PORT) {
    return
  }

  $reservedPorts = @()
  foreach ($value in @($env:EXOMIND_WEB_PORT, $env:EXOMIND_HMR_PORT)) {
    if ($value -and $value -match '^\d+$') {
      $reservedPorts += $value
    }
  }

  # Keep deterministic candidates first, then fallback to random port.
  #（优先固定候选端口，失败再回退到随机端口）
  $scriptPath = Join-Path $PSScriptRoot "embedded-runtime-port.ts"
  if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "embedded runtime port resolver script not found: $scriptPath"
  }

  $candidateCsv = "9124,1950,1949"
  $reservedCsv = ($reservedPorts | Select-Object -Unique) -join ","
  try {
    $resolved = (& bun $scriptPath $candidateCsv $reservedCsv 2>$null).Trim()
    if ($resolved -and $resolved -match '^\d+$') {
      $env:EXOMIND_RT_PORT = "$resolved"
      Write-Host "[tauri-wrapper] Embedded runtime port resolved: $resolved"
      return
    }
  } catch {
    Write-Warning "[tauri-wrapper] Failed to resolve embedded runtime port: $_"
  }

  throw "failed to resolve embedded runtime port"
}

function Resolve-TauriDevTargetDir {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
  )

  if ($env:CARGO_TARGET_DIR) {
    Write-Host "[tauri-wrapper] Reusing explicit CARGO_TARGET_DIR: $env:CARGO_TARGET_DIR"
    return
  }

  $scriptPath = Join-Path $PSScriptRoot "tauri-dev-target-dir.ts"
  if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "tauri dev target dir resolver script not found: $scriptPath"
  }

  $resolved = (& bun $scriptPath $ProjectRoot 2>$null | Select-Object -First 1)
  if (-not $resolved) {
    throw "failed to resolve tauri dev target dir"
  }

  $resolved = $resolved.Trim()
  if ([string]::IsNullOrWhiteSpace($resolved)) {
    throw "resolved tauri dev target dir is empty"
  }

  $env:CARGO_TARGET_DIR = $resolved
  New-Item -ItemType Directory -Path $resolved -Force | Out-Null
  Write-Host "[tauri-wrapper] Cargo target dir resolved: $resolved"
}

function Test-TruthyEnvValue {
  param(
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $false
  }

  $normalized = $Value.Trim().ToLowerInvariant()
  return $normalized -eq "1" -or $normalized -eq "true" -or $normalized -eq "yes" -or $normalized -eq "on"
}

function Add-TauriDevDefaultFlags {
  param(
    [string[]]$CommandArgs
  )

  if (-not $CommandArgs -or $CommandArgs.Count -eq 0) {
    return @()
  }

  $resolvedArgs = @($CommandArgs)
  $isDesktopDev = $resolvedArgs.Count -ge 1 -and $resolvedArgs[0] -eq "dev"
  if (-not $isDesktopDev) {
    return $resolvedArgs
  }

  if ((Test-TruthyEnvValue -Value $env:EXOMIND_TAURI_ENABLE_WATCH) -or ($resolvedArgs -contains "--no-watch")) {
    return $resolvedArgs
  }

  $separatorIndex = [Array]::IndexOf($resolvedArgs, "--")
  if ($separatorIndex -lt 0) {
    $separatorIndex = $resolvedArgs.Count
  }

  $updatedArgs = @()
  if ($separatorIndex -gt 0) {
    $updatedArgs += $resolvedArgs[0..($separatorIndex - 1)]
  }
  $updatedArgs += "--no-watch"
  if ($separatorIndex -lt $resolvedArgs.Count) {
    $updatedArgs += $resolvedArgs[$separatorIndex..($resolvedArgs.Count - 1)]
  }

  Write-Host "[tauri-wrapper] Disabled Tauri file watcher for dev (set EXOMIND_TAURI_ENABLE_WATCH=1 to opt in)."
  return $updatedArgs
}

function Test-IsAndroidDevCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$CommandArgs
  )

  return $CommandArgs.Count -ge 2 -and $CommandArgs[0] -eq "android" -and $CommandArgs[1] -eq "dev"
}

function Test-AndroidInstallFailureOutput {
  param(
    [AllowNull()]
    [object[]]$OutputLines
  )

  if (-not $OutputLines) {
    return $false
  }

  $joined = ($OutputLines | ForEach-Object { "$_" }) -join "`n"
  return $joined.Contains("failed to install APK") -or $joined.Contains("adb.exe: failed to install")
}

function Resolve-AdbCommandPath {
  $adbCommand = Get-Command adb -ErrorAction SilentlyContinue
  if ($adbCommand) {
    return $adbCommand.Source
  }

  if ($env:ANDROID_HOME) {
    $sdkAdb = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
    if (Test-Path -LiteralPath $sdkAdb) {
      return $sdkAdb
    }
  }

  return $null
}

function Resolve-AndroidDeviceSerial {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$CommandArgs,
    [Parameter(Mandatory = $true)]
    [string]$AdbPath
  )

  if ($CommandArgs.Count -ge 3 -and -not [string]::IsNullOrWhiteSpace($CommandArgs[2]) -and -not $CommandArgs[2].StartsWith("-")) {
    return $CommandArgs[2]
  }

  $adbDevicesOutput = & $AdbPath devices
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  $deviceLines = @($adbDevicesOutput | Where-Object {
    $line = "$_"
    $line -and $line -match "^\S+\s+device$"
  })

  if ($deviceLines.Count -eq 1) {
    return ($deviceLines[0] -split "\s+")[0]
  }

  return $null
}

function Resolve-AndroidTargetAbi {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$CommandArgs
  )

  for ($i = 0; $i -lt $CommandArgs.Count; $i++) {
    if ($CommandArgs[$i] -eq "--target" -and ($i + 1) -lt $CommandArgs.Count) {
      return $CommandArgs[$i + 1]
    }
  }

  return "x86_64"
}

function Resolve-AndroidBuiltApkPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [Parameter(Mandatory = $true)]
    [string]$TargetAbi
  )

  $preferredPath = Join-Path $ProjectRoot ("src-tauri\gen\android\app\build\outputs\apk\{0}\debug\app-{0}-debug.apk" -f $TargetAbi)
  if (Test-Path -LiteralPath $preferredPath) {
    return $preferredPath
  }

  $apkDir = Join-Path $ProjectRoot "src-tauri\gen\android\app\build\outputs\apk"
  if (-not (Test-Path -LiteralPath $apkDir)) {
    return $null
  }

  $latestApk = Get-ChildItem -Path $apkDir -Recurse -File -Filter "*.apk" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($latestApk) {
    return $latestApk.FullName
  }

  return $null
}

function Resolve-AndroidAppIdentifier {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
  )

  $tauriConfigPath = Join-Path $ProjectRoot "src-tauri\tauri.conf.json"
  if (-not (Test-Path -LiteralPath $tauriConfigPath)) {
    return $null
  }

  try {
    $raw = Get-Content -LiteralPath $tauriConfigPath -Raw -Encoding UTF8
    $json = $raw | ConvertFrom-Json
    return $json.identifier
  } catch {
    return $null
  }
}

function Invoke-AndroidInstallFallback {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [Parameter(Mandatory = $true)]
    [string[]]$CommandArgs
  )

  $adbPath = Resolve-AdbCommandPath
  if (-not $adbPath) {
    Write-Warning "[tauri-wrapper] Android fallback skipped: adb not found."
    return $false
  }

  $deviceSerial = Resolve-AndroidDeviceSerial -CommandArgs $CommandArgs -AdbPath $adbPath
  if (-not $deviceSerial) {
    Write-Warning "[tauri-wrapper] Android fallback skipped: unable to resolve a single device."
    return $false
  }

  $targetAbi = Resolve-AndroidTargetAbi -CommandArgs $CommandArgs
  $apkPath = Resolve-AndroidBuiltApkPath -ProjectRoot $ProjectRoot -TargetAbi $targetAbi
  if (-not $apkPath) {
    Write-Warning "[tauri-wrapper] Android fallback skipped: APK not found."
    return $false
  }

  $appId = Resolve-AndroidAppIdentifier -ProjectRoot $ProjectRoot
  if (-not $appId) {
    Write-Warning "[tauri-wrapper] Android fallback skipped: app identifier not found."
    return $false
  }

  Write-Host "[tauri-wrapper] Retrying Android install with adb fallback: $apkPath"
  & $adbPath -s $deviceSerial install -r -d -g -t $apkPath
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "[tauri-wrapper] Android fallback install failed."
    return $false
  }

  & $adbPath -s $deviceSerial shell monkey -p $appId -c android.intent.category.LAUNCHER 1 | Out-Null
  Write-Host "[tauri-wrapper] Android fallback install succeeded."
  return $true
}

function Invoke-TauriCommandWithCapture {
  param(
    [AllowNull()]
    [string[]]$CommandArgs
  )

  $capturedOutput = @()
  $exitCode = 0
  $previousErrorActionPreference = $ErrorActionPreference

  try {
    # Native stderr becomes ErrorRecord after 2>&1 in PowerShell.
    #（原生命令 stderr 经 2>&1 后会变成 ErrorRecord）
    # Tauri prints status lines like "Running BeforeDevCommand" to stderr,
    # so keep them as log output instead of terminating the wrapper.
    #（Tauri 会把状态日志写到 stderr，这里保留日志，不把它当成包装脚本异常）
    $ErrorActionPreference = "Continue"

    if ($CommandArgs -and $CommandArgs.Count -gt 0) {
      & tauri @CommandArgs 2>&1 | ForEach-Object {
        $capturedOutput += $_
        Write-Host "$_"
      }
    } else {
      & tauri 2>&1 | ForEach-Object {
        $capturedOutput += $_
        Write-Host "$_"
      }
    }

    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = $capturedOutput
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
Ensure-AndroidDebugCleartextTraffic -BuildGradlePath $buildGradlePath

# Ensure cargo is resolvable even when rustup shim is partial.
#（兼容仅安装 rustup、但 PATH 缺少 cargo 代理的环境）
Ensure-CargoFromRustup

# Resolve free dev port for desktop / android dev
#（桌面与 Android 开发模式都需要感知实例端口）
$isTauriDev = $TauriArgs -and $TauriArgs.Count -ge 1 -and $TauriArgs[0] -eq "dev"
$isAndroidDev = Test-IsAndroidDevCommand -CommandArgs $TauriArgs
$requiresDynamicDevUrl = $isTauriDev -or $isAndroidDev
if ($requiresDynamicDevUrl) {
  Resolve-FreeDevPort
}
if ($isTauriDev) {
  Resolve-EmbeddedRuntimePort
  Resolve-TauriDevTargetDir -ProjectRoot $projectRoot
}

# Sync launcher icons before android build/dev/run/init (构建前同步 Android 图标)
$androidCommandsNeedIconSync = @("build", "dev", "run", "init")
if ($TauriArgs -and $TauriArgs.Count -ge 2 -and $TauriArgs[0] -eq "android" -and ($androidCommandsNeedIconSync -contains $TauriArgs[1])) {
  Invoke-AndroidGeneratedProjectPatch -ProjectRoot $projectRoot
  Ensure-AndroidLauncherIcons -ProjectRoot $projectRoot
}

# Run tauri CLI (执行 tauri 命令)
$exitCode = 0
$tempConfigPath = $null
$tauriOutput = @()
try {
  $tauriCommandArgs = @()
  if ($TauriArgs -and $TauriArgs.Count -gt 0) {
    $tauriCommandArgs = Add-TauriDevDefaultFlags -CommandArgs $TauriArgs

    # Inject --config to override devUrl when port differs from default
    # (端口非默认值时，通过 --config 覆盖 devUrl)
    if ($requiresDynamicDevUrl -and $env:EXOMIND_WEB_PORT -and $env:EXOMIND_WEB_PORT -ne "1420") {
      $tempConfigPath = Join-Path $env:TEMP ("exomind-tauri-dev-config-{0}.json" -f [Guid]::NewGuid().ToString("N"))
      $devUrlOverride = '{"build":{"devUrl":"http://localhost:' + $env:EXOMIND_WEB_PORT + '"}}'
      Write-TextUtf8NoBom -Path $tempConfigPath -Content $devUrlOverride
      $tauriCommandArgs += @("--config", $tempConfigPath)
    }
  }

  $tauriResult = Invoke-TauriCommandWithCapture -CommandArgs $tauriCommandArgs
  $tauriOutput = @($tauriResult.Output)
  $exitCode = $tauriResult.ExitCode

  if ($exitCode -ne 0 -and (Test-IsAndroidDevCommand -CommandArgs $TauriArgs) -and (Test-AndroidInstallFailureOutput -OutputLines $tauriOutput)) {
    if (Invoke-AndroidInstallFallback -ProjectRoot $projectRoot -CommandArgs $TauriArgs) {
      $exitCode = 0
    }
  }
} finally {
  if ($tempConfigPath -and (Test-Path -LiteralPath $tempConfigPath)) {
    Remove-Item -LiteralPath $tempConfigPath -Force -ErrorAction SilentlyContinue
  }
}


# Patch again for `tauri android init`-like flows (初始化后再次补权限与 cleartext 配置)
if ($TauriArgs -and $TauriArgs.Count -ge 2 -and $TauriArgs[0] -eq "android") {
  Invoke-AndroidGeneratedProjectPatch -ProjectRoot $projectRoot
  Ensure-AndroidManifestPermissions -ManifestPath $manifestPath
  Ensure-AndroidReleaseCleartextTraffic -BuildGradlePath $buildGradlePath
  Ensure-AndroidDebugCleartextTraffic -BuildGradlePath $buildGradlePath
  if ($androidCommandsNeedIconSync -contains $TauriArgs[1]) {
    Ensure-AndroidLauncherIcons -ProjectRoot $projectRoot
  }
}

exit $exitCode
