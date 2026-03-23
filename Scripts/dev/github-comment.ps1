param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'github-comment.ts'
bun $scriptPath @Rest
