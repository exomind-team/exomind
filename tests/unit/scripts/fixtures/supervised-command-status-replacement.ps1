param([Parameter(Mandatory=$true)][string]$Directory,[Parameter(Mandatory=$true)][ValidateSet('read-no-delete','readonly')][string]$Mode)
$ErrorActionPreference='Stop'
$statusPath=Join-Path $Directory 'status.json'
$owner=Get-Content -LiteralPath (Join-Path $Directory 'owner.json') -Raw | ConvertFrom-Json
if(-not $owner.runId){throw 'Missing owned replacement fixture identity'}
if($Mode -eq 'readonly') {
  [IO.File]::SetAttributes($statusPath,([IO.File]::GetAttributes($statusPath) -bor [IO.FileAttributes]::ReadOnly))
  # The real supervisor must reject publication, not clear the attribute. Its
  # Job cleanup may terminate this child; the test owner restores the attribute.
  Start-Sleep -Milliseconds 1200
  exit 0
}
$stream=[IO.File]::Open($statusPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
$reader=[IO.StreamReader]::new($stream,[Text.Encoding]::UTF8,$true,1024,$true)
try {
  $before=$reader.ReadToEnd()
  if(($before|ConvertFrom-Json).runId -ne $owner.runId){throw 'Wrong owned status snapshot'}
  Start-Sleep -Milliseconds 300
  $reader.DiscardBufferedData()
  [void]$stream.Seek(0,[IO.SeekOrigin]::Begin)
  $after=$reader.ReadToEnd()
  if($before -ne $after){throw 'An open status snapshot was modified in place'}
} finally { $reader.Dispose();$stream.Dispose() }
[IO.File]::WriteAllText((Join-Path $Directory 'status-reader-proof.json'),'{"heldSnapshotUnchanged":true}',[Text.UTF8Encoding]::new($false))
