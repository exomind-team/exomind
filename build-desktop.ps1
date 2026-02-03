# Tauri 桌面端构建脚本
# 用法: .\build-desktop.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Tauri Desktop Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否在项目根目录
if (-not (Test-Path "src-tauri")) {
    Write-Host "错误: 请在项目根目录运行此脚本" -ForegroundColor Red
    exit 1
}

# 清理旧的构建产物
Write-Host "[1/4] 清理旧构建产物..." -ForegroundColor Yellow
if (Test-Path "src-tauri/target") {
    Remove-Item -Recurse -Force "src-tauri/target" -ErrorAction SilentlyContinue
    Write-Host "      已清理 target 目录" -ForegroundColor Green
}

# 安装依赖
Write-Host "[2/4] 安装依赖..." -ForegroundColor Yellow
try {
    bun install
    Write-Host "      依赖安装完成" -ForegroundColor Green
} catch {
    Write-Host "      依赖安装失败: $_" -ForegroundColor Red
    exit 1
}

# 构建前端
Write-Host "[3/4] 构建前端..." -ForegroundColor Yellow
try {
    bun run build
    Write-Host "      前端构建完成" -ForegroundColor Green
} catch {
    Write-Host "      前端构建失败: $_" -ForegroundColor Red
    exit 1
}

# 构建 Tauri 桌面应用
Write-Host "[4/4] 构建 Tauri 桌面应用..." -ForegroundColor Yellow
try {
    bun run tauri build
    Write-Host "      桌面应用构建完成" -ForegroundColor Green
} catch {
    Write-Host "      桌面应用构建失败: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  构建成功!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# 显示输出文件
$msiPath = "src-tauri\target\release\bundle\msi\tauri-app_0.1.0_x64_en-US.msi"
$exePath = "src-tauri\target\release\bundle\nsis\tauri-app_0.1.0_x64-setup.exe"

Write-Host "输出文件:" -ForegroundColor Cyan
if (Test-Path $msiPath) {
    $msiSize = (Get-Item $msiPath).Length / 1MB
    Write-Host "  MSI: $msiPath ($([math]::Round($msiSize, 2)) MB)" -ForegroundColor White
}
if (Test-Path $exePath) {
    $exeSize = (Get-Item $exePath).Length / 1MB
    Write-Host "  EXE: $exePath ($([math]::Round($exeSize, 2)) MB)" -ForegroundColor White
}

Write-Host ""
Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
