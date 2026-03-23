<#
.SYNOPSIS
    Prepare and validate Android signing secrets for GitHub Actions.

.DESCRIPTION
    1) Validate keystore / alias / passwords via keytool.
    2) Generate ANDROID_KEYSTORE_BASE64 text file.
    3) Optionally push all Android signing secrets to GitHub repository secrets.

.PARAMETER KeystorePath
    Path to Android keystore file (.jks / .keystore).

.PARAMETER StorePassword
    Keystore password (ANDROID_KEYSTORE_PASSWORD).

.PARAMETER KeyAlias
    Key alias inside keystore (ANDROID_KEY_ALIAS).

.PARAMETER KeyPassword
    Key password for alias (ANDROID_KEY_PASSWORD).

.PARAMETER OutFile
    Output file path for Base64 text. Default: ANDROID_KEYSTORE_BASE64.txt

.PARAMETER Repo
    GitHub repository in owner/name format. Default: exomind-team/exomind

.PARAMETER SetGhSecrets
    If set, write all 4 secrets to GitHub via gh CLI.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$KeystorePath,

    [Parameter(Mandatory = $true)]
    [string]$StorePassword,

    [Parameter(Mandatory = $true)]
    [string]$KeyAlias,

    [Parameter(Mandatory = $true)]
    [string]$KeyPassword,

    [string]$OutFile = "ANDROID_KEYSTORE_BASE64.txt",
    [string]$Repo = "exomind-team/exomind",
    [switch]$SetGhSecrets
)

$ErrorActionPreference = "Stop"

function Resolve-KeytoolPath {
    if ($env:JAVA_HOME) {
        $candidate = Join-Path $env:JAVA_HOME "bin\keytool.exe"
        if (Test-Path $candidate) { return $candidate }
    }

    $defaultJavaHome = "C:\Program Files\Eclipse Adoptium\jdk-17.0.13.11-hotspot"
    $defaultKeytool = Join-Path $defaultJavaHome "bin\keytool.exe"
    if (Test-Path $defaultKeytool) { return $defaultKeytool }

    $cmd = Get-Command keytool -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    throw "keytool not found. Please install JDK 17 and set JAVA_HOME."
}

if (-not (Test-Path -LiteralPath $KeystorePath)) {
    throw "Keystore file not found: $KeystorePath"
}

$resolvedKeystore = (Resolve-Path -LiteralPath $KeystorePath).Path
$keytool = Resolve-KeytoolPath

Write-Host "[1/4] Validate keystore/alias with keytool (校验 keystore/alias)..."
$tmpOut = Join-Path $env:TEMP ("keytool-out-" + [guid]::NewGuid().ToString("N") + ".log")
$tmpErr = Join-Path $env:TEMP ("keytool-err-" + [guid]::NewGuid().ToString("N") + ".log")
$keytoolArgs = @(
    "-list",
    "-keystore", $resolvedKeystore,
    "-storepass", $StorePassword,
    "-alias", $KeyAlias,
    "-keypass", $KeyPassword
)
$proc = Start-Process -FilePath $keytool `
    -ArgumentList $keytoolArgs `
    -Wait `
    -PassThru `
    -NoNewWindow `
    -RedirectStandardOutput $tmpOut `
    -RedirectStandardError $tmpErr
if ($proc.ExitCode -ne 0) {
    $errText = if (Test-Path $tmpErr) { Get-Content -Path $tmpErr -Raw } else { "" }
    throw "Keytool validation failed. Check keystore path / alias / passwords. $errText"
}
Remove-Item -Path $tmpOut, $tmpErr -Force -ErrorAction SilentlyContinue
Write-Host "OK: keystore and alias are valid."

Write-Host "[2/4] Generate Base64 for ANDROID_KEYSTORE_BASE64 (生成 Base64)..."
$bytes = [System.IO.File]::ReadAllBytes($resolvedKeystore)
$base64 = [Convert]::ToBase64String($bytes)
if ([string]::IsNullOrWhiteSpace($base64)) {
    throw "Generated Base64 content is empty."
}

$outPath = (Join-Path (Get-Location) $OutFile)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outPath, $base64, $utf8NoBom)
Write-Host "OK: Base64 file created: $outPath"

Write-Host "[3/4] Verify Base64 roundtrip (校验 Base64 可逆)..."
$decoded = [Convert]::FromBase64String($base64)
if ($decoded.Length -ne $bytes.Length) {
    throw "Base64 roundtrip length mismatch."
}
Write-Host "OK: roundtrip check passed. bytes=$($bytes.Length)"

Write-Host "[4/4] Summary (汇总)"
Write-Host "Repo: $Repo"
Write-Host "Secret: ANDROID_KEYSTORE_BASE64 -> $outPath"
Write-Host "Secret: ANDROID_KEYSTORE_PASSWORD -> (provided)"
Write-Host "Secret: ANDROID_KEY_ALIAS -> $KeyAlias"
Write-Host "Secret: ANDROID_KEY_PASSWORD -> (provided)"

if ($SetGhSecrets) {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $gh) {
        throw "gh CLI not found. Install GitHub CLI first."
    }

    Write-Host "Writing secrets to GitHub (写入 GitHub Secrets)..."
    gh secret set ANDROID_KEYSTORE_BASE64 --repo $Repo --body $base64 | Out-Null
    gh secret set ANDROID_KEYSTORE_PASSWORD --repo $Repo --body $StorePassword | Out-Null
    gh secret set ANDROID_KEY_ALIAS --repo $Repo --body $KeyAlias | Out-Null
    gh secret set ANDROID_KEY_PASSWORD --repo $Repo --body $KeyPassword | Out-Null
    Write-Host "OK: all Android signing secrets updated."
} else {
    Write-Host "Next step (下一步):"
    Write-Host "  1) Configure the 4 secrets in GitHub Actions."
    Write-Host "  2) Re-run release tag workflow."
}
