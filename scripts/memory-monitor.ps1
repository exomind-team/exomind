# ExoMind Memory Monitor
# Tracks Tauri + WebView2 process memory over time.
# Usage: powershell -File scripts\memory-monitor.ps1 [-IntervalSeconds 60] [-DurationHours 8]
param(
    [int]$IntervalSeconds = 60,
    [int]$DurationHours = 8
)

$endTime = (Get-Date).AddHours($DurationHours)
$logFile = Join-Path $PSScriptRoot "memory-monitor-$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"

# CSV header
"log_time,exomind_mb,total_webview2_mb,webview2_process_count,all_exomind_processes_mb" | Out-File -Encoding utf8 $logFile

Write-Host "ExoMind Memory Monitor" -ForegroundColor Cyan
Write-Host "  Interval: ${IntervalSeconds}s | Duration: ${DurationHours}h | Log: $logFile"
Write-Host "  Monitoring until: $endTime"
Write-Host ""

$iteration = 0
while ((Get-Date) -lt $endTime) {
    $iteration++
    $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    # Get all ExoMind-related processes
    $exomindProc = Get-Process -Name "exomind" -ErrorAction SilentlyContinue
    $webview2Procs = Get-Process -Name "msedgewebview2" -ErrorAction SilentlyContinue

    $exomindMb = if ($exomindProc) { [math]::Round(($exomindProc.WorkingSet64 / 1MB), 1) } else { 0 }
    $webview2Count = if ($webview2Procs) { $webview2Procs.Count } else { 0 }
    $webview2TotalMb = if ($webview2Procs) { [math]::Round((($webview2Procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB), 1) } else { 0 }

    # All processes that might belong to ExoMind (exomind + its WebView2 children)
    $allProcs = @()
    if ($exomindProc) { $allProcs += $exomindProc }
    if ($webview2Procs) { $allProcs += $webview2Procs }
    $totalMb = if ($allProcs.Count -gt 0) { [math]::Round((($allProcs | Measure-Object WorkingSet64 -Sum).Sum / 1MB), 1) } else { 0 }

    $line = "$now,$exomindMb,$webview2TotalMb,$webview2Count,$totalMb"
    $line | Out-File -Encoding utf8 -Append $logFile

    # Console output with color coding
    $color = if ($totalMb -gt 1500) { "Red" } elseif ($totalMb -gt 800) { "Yellow" } else { "Green" }
    Write-Host "[$now] " -NoNewline
    Write-Host "ExoMind: ${exomindMb}MB | WebView2: ${webview2TotalMb}MB (${webview2Count} procs) | Total: ${totalMb}MB" -ForegroundColor $color

    # Alert on memory spike
    if ($totalMb -gt 2000) {
        Write-Host "  *** ALERT: Total memory exceeds 2GB! Potential leak detected. ***" -ForegroundColor Red
    }

    Start-Sleep -Seconds $IntervalSeconds
}

Write-Host ""
Write-Host "Monitoring complete. Log saved to: $logFile" -ForegroundColor Cyan
Write-Host "Peak memory analysis:"
$csv = Import-Csv $logFile -Header "time","exomind","webview2_total","wv2_count","total"
$peakTotal = ($csv | Measure-Object total -Maximum).Maximum
$peakWv2 = ($csv | Measure-Object webview2_total -Maximum).Maximum
$finalTotal = ($csv | Select-Object -Last 1).total
$firstTotal = ($csv | Select-Object -First 1).total
Write-Host "  Peak total: ${peakTotal}MB | Peak WebView2: ${peakWv2}MB"
Write-Host "  Start: ${firstTotal}MB -> End: ${finalTotal}MB (delta: $([math]::Round([double]$finalTotal - [double]$firstTotal, 1))MB)"
