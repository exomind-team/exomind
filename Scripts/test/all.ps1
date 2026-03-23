<#
.SYNOPSIS
    运行全部测试

.DESCRIPTION
    运行单元测试和集成测试
#>
param(
    [switch]$SkipUnit,
    [switch]$SkipIntegration
)

$ErrorActionPreference = "Stop"

# 导入共享配置
. "$PSScriptRoot/../_shared/config.ps1"

Clear-Host
Write-Header "ExoMind 测试套件"

$exitCode = 0

# 单元测试
if (-not $SkipUnit) {
    Write-Host "=== 运行单元测试 ===" -ForegroundColor Cyan
    try {
        . "$PSScriptRoot/unit.ps1"
        Write-Success "单元测试通过"
    } catch {
        Write-Error "单元测试失败: $_"
        $exitCode = 1
    }
}

# 集成测试
if (-not $SkipIntegration) {
    Write-Host "`n=== 运行集成测试 ===" -ForegroundColor Cyan
    try {
        . "$PSScriptRoot/integration.ps1"
        Write-Success "集成测试通过"
    } catch {
        Write-Error "集成测试失败: $_"
        $exitCode = 1
    }
}

Write-Header "测试完成" $(if ($exitCode -eq 0) { "Green" } else { "Red" })
exit $exitCode
