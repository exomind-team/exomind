param(
  [int]$Port = 39081,
  [int]$StartupTimeoutSeconds = 20
)

$ErrorActionPreference = "Stop"

function Get-RuntimeVersion {
  $runtimeManifest = Get-Content -Path "crates/exomind-runtime/Cargo.toml" -Raw -Encoding UTF8
  $match = [regex]::Match($runtimeManifest, '(?m)^version\s*=\s*"([^"]+)"')
  if (-not $match.Success) {
    throw "Cannot resolve exomind-runtime version from Cargo.toml"
  }
  return $match.Groups[1].Value
}

$expectedVersion = Get-RuntimeVersion
$runtimeUrl = "http://127.0.0.1:$Port/health"
$stdoutPath = Join-Path $PWD ".tmp-exomind-runtime-smoke.stdout.log"
$stderrPath = Join-Path $PWD ".tmp-exomind-runtime-smoke.stderr.log"
Add-Type -AssemblyName System.Net.Http
$httpClient = [System.Net.Http.HttpClient]::new()
$httpClient.Timeout = [TimeSpan]::FromSeconds(2)

Remove-Item $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
$env:EXOMIND_RT_PORT = "$Port"

Write-Host "[exomind-runtime-smoke] Starting runtime via cargo run (通过 cargo run 启动 runtime)..."
$process = Start-Process -FilePath "cargo" -ArgumentList @("run", "-p", "exomind-runtime") -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru

try {
  $response = $null
  $responseBody = ""
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = $httpClient.GetAsync($runtimeUrl).GetAwaiter().GetResult()
      $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      if ([int]$response.StatusCode -eq 200) {
        break
      }
    } catch {
      Start-Sleep -Milliseconds 300
    }
  }

  if (-not $response -or [int]$response.StatusCode -ne 200) {
    $stdout = Get-Content -Path $stdoutPath -Raw -ErrorAction SilentlyContinue
    $stderr = Get-Content -Path $stderrPath -Raw -ErrorAction SilentlyContinue
    throw "Runtime health check timeout. stdout:`n$stdout`nstderr:`n$stderr"
  }

  $payload = $responseBody | ConvertFrom-Json
  if ($payload.status -ne "ok") {
    throw "Unexpected health status: $($payload.status)"
  }
  if ($payload.version -ne $expectedVersion) {
    throw "Unexpected runtime version. expected=$expectedVersion actual=$($payload.version)"
  }

  Write-Host "[exomind-runtime-smoke] PASS status=ok version=$($payload.version)"
}
finally {
  if ($httpClient) {
    $httpClient.Dispose()
  }
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
  Remove-Item Env:EXOMIND_RT_PORT -ErrorAction SilentlyContinue
  Remove-Item $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
}
