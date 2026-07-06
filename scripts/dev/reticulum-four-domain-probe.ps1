param(
  [string]$SourceRuntime = "http://127.0.0.1:9224",
  [string]$TargetRuntime = "http://127.0.0.1:9324",
  [string]$Scope = "",
  [int]$TimeoutSeconds = 40,
  [int]$PollMilliseconds = 500,
  [string]$ExpectedProviderId = "runtime-reticulum-ens",
  [switch]$Bidirectional
)

$ErrorActionPreference = "Stop"

function Normalize-RuntimeUrl {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Runtime URL must not be empty"
  }

  return $Value.Trim().TrimEnd("/")
}

function New-ProbeId {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $suffix = ([guid]::NewGuid().ToString("N")).Substring(0, 8)
  return "reticulum-manual-$stamp-$suffix"
}

function ConvertTo-JsonBody {
  param([object]$Value)
  return ($Value | ConvertTo-Json -Depth 30 -Compress)
}

function Invoke-JsonPost {
  param(
    [string]$Uri,
    [object]$Body
  )

  Invoke-RestMethod -Uri $Uri -Method Post -ContentType "application/json; charset=utf-8" -Body (ConvertTo-JsonBody $Body)
}

function Invoke-JsonGet {
  param([string]$Uri)
  Invoke-RestMethod -Uri $Uri -Method Get
}

function Get-JsonText {
  param([string]$Uri)
  return ((Invoke-JsonGet -Uri $Uri) | ConvertTo-Json -Depth 40 -Compress)
}

function Get-EnsSnapshot {
  param(
    [string]$Runtime,
    [string]$Name
  )

  $snapshot = Invoke-JsonGet -Uri "$Runtime/mesh/ens/snapshot"
  if (-not $snapshot.enabled) {
    throw "$Name ENS snapshot is disabled"
  }
  if ($snapshot.provider_id -ne $ExpectedProviderId) {
    throw "$Name provider mismatch. expected=$ExpectedProviderId actual=$($snapshot.provider_id)"
  }
  if (-not $snapshot.local_identity -or [string]::IsNullOrWhiteSpace($snapshot.local_identity.identity_hex)) {
    throw "$Name snapshot is missing local_identity.identity_hex"
  }
  if (-not $snapshot.health -or $snapshot.health.status -ne "healthy") {
    throw "$Name ENS health is not healthy: $($snapshot.health.status)"
  }

  return $snapshot
}

function Assert-AuthorizedPeer {
  param(
    [object]$Snapshot,
    [string]$ExpectedPeerIdentity,
    [string]$Name
  )

  $peer = @($Snapshot.peers) | Where-Object {
    $_.identity -and $_.identity.identity_hex -eq $ExpectedPeerIdentity
  } | Select-Object -First 1

  if (-not $peer) {
    throw "$Name snapshot does not include expected Reticulum peer identity $ExpectedPeerIdentity"
  }
  if (-not $peer.authorized) {
    throw "$Name peer $ExpectedPeerIdentity is not authorized"
  }
  if ($peer.pairing_pending) {
    throw "$Name peer $ExpectedPeerIdentity still has pairing_pending=true"
  }
  if (-not $peer.endpoint -or $peer.endpoint.gateway -ne "reticulum") {
    throw "$Name peer $ExpectedPeerIdentity is not advertised through Reticulum gateway"
  }
}

function Wait-RouteContains {
  param(
    [string]$Domain,
    [string]$Uri,
    [string]$Needle
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $attempts = 0
  while ((Get-Date) -lt $deadline) {
    $attempts += 1
    try {
      $json = Get-JsonText -Uri $Uri
      if ($json.Contains($Needle)) {
        return [pscustomobject]@{
          domain = $Domain
          ok = $true
          attempts = $attempts
          needle = $Needle
          route = $Uri
        }
      }
    } catch {
      if ((Get-Date) -ge $deadline) {
        throw
      }
    }
    Start-Sleep -Milliseconds $PollMilliseconds
  }

  throw "$Domain did not appear on read runtime business route before timeout. route=$Uri needle=$Needle"
}

function Invoke-FourDomainProbeRun {
  param(
    [string]$Direction,
    [string]$WriteRuntime,
    [string]$ReadRuntime,
    [object]$WriteSnapshot,
    [object]$ReadSnapshot,
    [string]$RunScope,
    [switch]$IncludeDirectionInDomain
  )

  $scopeQuery = [uri]::EscapeDataString($RunScope)
  $marker = $RunScope
  $eventlogDomain = if ($IncludeDirectionInDomain) { "$Direction EventLog" } else { "EventLog" }
  $taskDomain = if ($IncludeDirectionInDomain) { "$Direction Task" } else { "Task" }
  $timeblockDomain = if ($IncludeDirectionInDomain) { "$Direction TimeBlock" } else { "TimeBlock" }
  $proposalDomain = if ($IncludeDirectionInDomain) { "$Direction Proposal" } else { "Proposal" }

  $eventId = "manual-event-$([guid]::NewGuid().ToString("N"))"
  Invoke-JsonPost -Uri "$WriteRuntime/eventlog?user_id=$scopeQuery" -Body @{
    id = $eventId
    content = "Reticulum EventLog manual probe $marker"
    tags = @("reticulum-manual", $marker)
    refs = @()
    metadata = @{
      reticulumProbeId = $marker
      domain = "eventlog"
    }
  } | Out-Null

  $task = Invoke-JsonPost -Uri "$WriteRuntime/tasks?user_id=$scopeQuery" -Body @{
    title = "Reticulum Task manual probe $marker"
    tags = @("reticulum-manual", $marker)
    source = "reticulum-manual"
    depends_on = @()
    time_block_ids = @()
  }
  if ([string]::IsNullOrWhiteSpace($task.id)) {
    throw "$Direction task creation did not return an id"
  }

  Invoke-JsonPost -Uri "$WriteRuntime/timeblocks/new?user_id=$scopeQuery" -Body @{
    blockType = "active"
    name = "Reticulum TimeBlock manual probe $marker"
    mode = "countup"
    targetMinutes = 25
  } | Out-Null

  $proposal = Invoke-JsonPost -Uri "$WriteRuntime/api/proposals?user_id=$scopeQuery" -Body @{
    title = "Reticulum Proposal manual probe $marker"
    body = "Reticulum Proposal manual probe body $marker"
    action_type = "append_event"
    action_params = @{
      content = "Reticulum proposal sync probe $marker"
      tags = @("reticulum-manual", $marker)
    }
    publisher = @{
      publisher_type = "human"
      id = "manual-verifier"
      name = "Manual Verifier"
    }
  }
  if ([string]::IsNullOrWhiteSpace($proposal.id)) {
    throw "$Direction proposal creation did not return an id"
  }

  $results = @()
  $results += Wait-RouteContains -Domain $eventlogDomain -Uri "$ReadRuntime/eventlog?user_id=$scopeQuery" -Needle $eventId
  $results += Wait-RouteContains -Domain $taskDomain -Uri "$ReadRuntime/tasks?user_id=$scopeQuery" -Needle $task.id
  $results += Wait-RouteContains -Domain $timeblockDomain -Uri "$ReadRuntime/timeblocks/active?user_id=$scopeQuery" -Needle $marker
  $results += Wait-RouteContains -Domain $proposalDomain -Uri "$ReadRuntime/api/proposals?user_id=$scopeQuery" -Needle $proposal.id

  return [pscustomobject]@{
    direction = $Direction
    write_runtime = $WriteRuntime
    read_runtime = $ReadRuntime
    scope = $RunScope
    write_identity_hex = $WriteSnapshot.local_identity.identity_hex
    read_identity_hex = $ReadSnapshot.local_identity.identity_hex
    writes = [pscustomobject]@{
      event_id = $eventId
      task_id = $task.id
      timeblock_marker = $marker
      proposal_id = $proposal.id
    }
    remote_business_route_reads = $results
  }
}

$SourceRuntime = Normalize-RuntimeUrl -Value $SourceRuntime
$TargetRuntime = Normalize-RuntimeUrl -Value $TargetRuntime
if ([string]::IsNullOrWhiteSpace($Scope)) {
  $Scope = New-ProbeId
}

$sourceSnapshot = Get-EnsSnapshot -Runtime $SourceRuntime -Name "source"
$targetSnapshot = Get-EnsSnapshot -Runtime $TargetRuntime -Name "target"
Assert-AuthorizedPeer -Snapshot $sourceSnapshot -ExpectedPeerIdentity $targetSnapshot.local_identity.identity_hex -Name "source"
Assert-AuthorizedPeer -Snapshot $targetSnapshot -ExpectedPeerIdentity $sourceSnapshot.local_identity.identity_hex -Name "target"

$runs = @()
$forwardScope = $Scope
if ($Bidirectional) {
  $forwardScope = "$Scope-source-to-target"
}
$runs += Invoke-FourDomainProbeRun `
  -Direction "source_to_target" `
  -WriteRuntime $SourceRuntime `
  -ReadRuntime $TargetRuntime `
  -WriteSnapshot $sourceSnapshot `
  -ReadSnapshot $targetSnapshot `
  -RunScope $forwardScope `
  -IncludeDirectionInDomain:$Bidirectional

if ($Bidirectional) {
  $runs += Invoke-FourDomainProbeRun `
    -Direction "target_to_source" `
    -WriteRuntime $TargetRuntime `
    -ReadRuntime $SourceRuntime `
    -WriteSnapshot $targetSnapshot `
    -ReadSnapshot $sourceSnapshot `
    -RunScope "$Scope-target-to-source" `
    -IncludeDirectionInDomain
}

$output = [ordered]@{
  ok = $true
  bidirectional = [bool]$Bidirectional
  source_runtime = $SourceRuntime
  target_runtime = $TargetRuntime
  scope = $Scope
  source_identity_hex = $sourceSnapshot.local_identity.identity_hex
  target_identity_hex = $targetSnapshot.local_identity.identity_hex
  runs = $runs
  note = "HTTP routes were used only as local control/observation. Pass criteria are remote/read-runtime business route reads after Reticulum authorization."
}

if (-not $Bidirectional) {
  $output["writes"] = $runs[0].writes
  $output["remote_business_route_reads"] = $runs[0].remote_business_route_reads
}

[pscustomobject]$output | ConvertTo-Json -Depth 40
