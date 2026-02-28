param(
  [Parameter(Mandatory = $false)]
  [string]$Repo,

  [Parameter(Mandatory = $false)]
  [ValidateRange(1, 50)]
  [int]$KeepRuns = 3,

  [Parameter(Mandatory = $false)]
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-Repo {
  param([string]$InputRepo)

  if ($InputRepo) {
    return $InputRepo
  }

  $remoteUrl = (git config --get remote.origin.url).Trim()
  if (-not $remoteUrl) {
    throw "Cannot resolve repo. Pass -Repo owner/name."
  }

  # Support HTTPS and SSH remote URL formats (支持 HTTPS/SSH 仓库地址)
  if ($remoteUrl -match "github\.com[:/](?<owner>[^/]+)/(?<name>[^/.]+)(\.git)?$") {
    return "$($Matches.owner)/$($Matches.name)"
  }

  throw "Unsupported remote URL format: $remoteUrl. Pass -Repo owner/name."
}

function Get-AllArtifacts {
  param([string]$TargetRepo)

  $result = @()
  for ($page = 1; $page -le 50; $page++) {
    $response = gh api "repos/$TargetRepo/actions/artifacts?per_page=100&page=$page" | ConvertFrom-Json
    if (-not $response.artifacts -or $response.artifacts.Count -eq 0) {
      break
    }
    $result += $response.artifacts
  }
  return $result
}

function Format-Bytes {
  param([double]$Bytes)

  if ($Bytes -ge 1GB) {
    return ("{0:N2} GB" -f ($Bytes / 1GB))
  }
  if ($Bytes -ge 1MB) {
    return ("{0:N2} MB" -f ($Bytes / 1MB))
  }
  if ($Bytes -ge 1KB) {
    return ("{0:N2} KB" -f ($Bytes / 1KB))
  }
  return ("{0:N0} B" -f $Bytes)
}

function Get-TotalSizeBytes {
  param($Items)

  $list = @($Items)
  if ($list.Count -eq 0) {
    return 0.0
  }

  $measure = $list | Measure-Object -Property size_in_bytes -Sum
  if (-not $measure -or $null -eq $measure.Sum) {
    return 0.0
  }

  return [double]$measure.Sum
}

$targetRepo = Resolve-Repo -InputRepo $Repo
Write-Host "Target repo: $targetRepo"
Write-Host "Keep latest runs: $KeepRuns"
$modeText = "DRY RUN"
if ($Apply) {
  $modeText = "APPLY (delete)"
}
Write-Host "Mode: $modeText"

$allArtifacts = @(Get-AllArtifacts -TargetRepo $targetRepo)
if (-not $allArtifacts -or $allArtifacts.Count -eq 0) {
  Write-Host "No artifacts found."
  exit 0
}

$totalSize = Get-TotalSizeBytes -Items $allArtifacts
Write-Host ("Current artifacts: {0} ({1})" -f $allArtifacts.Count, (Format-Bytes -Bytes $totalSize))

# Run recency is derived from latest artifact timestamp per run (按每个 run 的最新 artifact 时间排序)
$runGroups = @($allArtifacts | Group-Object {
  if ($_.workflow_run -and $_.workflow_run.id) { [string]$_.workflow_run.id } else { "__NO_RUN__" }
})

$runsSorted = @($runGroups |
  Sort-Object {
    $latest = $_.Group | Sort-Object { [datetime]$_.created_at } -Descending | Select-Object -First 1
    [datetime]$latest.created_at
  } -Descending)

$keepRunIds = @()
$i = 0
foreach ($run in $runsSorted) {
  if ($run.Name -eq "__NO_RUN__") {
    continue
  }
  $keepRunIds += $run.Name
  $i++
  if ($i -ge $KeepRuns) {
    break
  }
}

Write-Host "Keeping run IDs:"
foreach ($runId in $keepRunIds) {
  Write-Host "  - $runId"
}

$toDelete = @($allArtifacts | Where-Object {
  $runId = if ($_.workflow_run -and $_.workflow_run.id) { [string]$_.workflow_run.id } else { "__NO_RUN__" }
  -not ($keepRunIds -contains $runId)
})

$deleteSize = Get-TotalSizeBytes -Items $toDelete
Write-Host ("Delete candidates: {0} ({1})" -f $toDelete.Count, (Format-Bytes -Bytes $deleteSize))

if (@($toDelete).Count -eq 0) {
  Write-Host "Nothing to delete."
  exit 0
}

Write-Host "Sample delete candidates (top 10 by created_at):"
$toDelete |
  Sort-Object { [datetime]$_.created_at } -Descending |
  Select-Object -First 10 |
  ForEach-Object {
    $runId = if ($_.workflow_run -and $_.workflow_run.id) { $_.workflow_run.id } else { "N/A" }
    Write-Host ("  - id={0} run={1} size={2} created_at={3} name={4}" -f `
      $_.id, $runId, (Format-Bytes -Bytes $_.size_in_bytes), $_.created_at, $_.name)
  }

if (-not $Apply) {
  Write-Host "Dry run complete. Re-run with -Apply to delete these artifacts."
  exit 0
}

$deletedCount = 0
$deletedBytes = 0.0
$failed = @()

foreach ($artifact in @($toDelete)) {
  try {
    gh api -X DELETE "repos/$targetRepo/actions/artifacts/$($artifact.id)" | Out-Null
    $deletedCount++
    $deletedBytes += [double]$artifact.size_in_bytes
    Write-Host ("Deleted artifact id={0} name={1}" -f $artifact.id, $artifact.name)
  } catch {
    $failed += $artifact
    Write-Warning ("Failed to delete artifact id={0} name={1}. {2}" -f $artifact.id, $artifact.name, $_.Exception.Message)
  }
}

Write-Host ("Deleted: {0} ({1})" -f $deletedCount, (Format-Bytes -Bytes $deletedBytes))
if (@($failed).Count -gt 0) {
  Write-Warning ("Delete failures: {0}" -f $failed.Count)
}

$remaining = Get-AllArtifacts -TargetRepo $targetRepo
$remainingSize = Get-TotalSizeBytes -Items $remaining
Write-Host ("Remaining artifacts: {0} ({1})" -f $remaining.Count, (Format-Bytes -Bytes $remainingSize))
