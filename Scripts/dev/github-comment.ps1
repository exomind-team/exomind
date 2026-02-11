param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'github_comment.py'
python $scriptPath @Rest
