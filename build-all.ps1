# Tauri 全平台构建脚本
# 用法: .\build-all.ps1
# 构建桌面端 (MSI + NSIS) 和 Android APK

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Tauri All Platforms Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$startTime = Get-Date

# 构建桌面端
Write-Host "[阶段 1/2] 构建桌面端..." -ForegroundColor Magenta
Write-Host ""
try {
    & ".\build-desktop.ps1"
} catch {
    Write-Host "桌面端构建失败，继续构建 Android..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[阶段 2/2] 构建 Android..." -ForegroundColor Magenta
Write-Host ""
try {
    & ".\build-android.ps1"
} catch {
    Write-Host "Android 构建失败" -ForegroundColor Red
}

# 计算耗时
$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  全部构建完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "总耗时: $($duration.Minutes)分 $($duration.Seconds)秒" -ForegroundColor Cyan
Write-Host ""

# 汇总输出文件
Write-Host "构建产物汇总:" -ForegroundColor Cyan
Write-Host ""

$outputs = @(
    @{Path="src-tauri\target\release\bundle\msi\tauri-app_0.1.0_x64_en-US.msi"; Name="Windows MSI 安装包"},
    @{Path="src-tauri\target\release\bundle\nsis\tauri-app_0.1.0_x64-setup.exe"; Name="Windows EXE 安装程序"},
    @{Path="src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk"; Name="Android 调试版 APK"},
    @{Path="src-tauri\gen\android\app\build\outputs\apk\release\app-release.apk"; Name="Android 发布版 APK"}
)

foreach ($output in $outputs) {
    if (Test-Path $output.Path) {
        $size = (Get-Item $output.Path).Length / 1MB
        Write-Host "  ✓ $($output.Name)" -ForegroundColor Green
        Write-Host "    $($output.Path) ($([math]::Round($size, 2)) MB)" -ForegroundColor Gray
    }
}

Write-Host ""
