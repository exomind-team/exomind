<#
.SYNOPSIS
    运行单元测试

.DESCRIPTION
    使用 Vitest 运行前端单元测试
#>
param(
    [switch]$Watch,
    [switch]$Coverage
)

$ErrorActionPreference = "Stop"

# 导入共享配置
. "$PSScriptRoot/../_shared/config.ps1"

Clear-Host
Write-Header "ExoMind 单元测试"

# 切换到项目根目录
Set-Location $Global:EMConfig.ProjectRoot

# 检查项目目录
Test-ProjectRoot

Write-Host "运行 Vitest 单元测试..." -ForegroundColor Cyan
Write-Host ""

$args = @()
if ($Watch) {
    $args += "--watch"
}
if ($Coverage) {
    $args += "--coverage"
}

bun run test $args
