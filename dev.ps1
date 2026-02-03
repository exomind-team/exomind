# Tauri 开发模式启动脚本
# 用法: .\dev.ps1 [desktop|android]
# 默认启动桌面端开发模式

param(
    [string]$Platform = "desktop"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Tauri Development Mode" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查项目目录
if (-not (Test-Path "src-tauri")) {
    Write-Host "错误: 请在项目根目录运行此脚本" -ForegroundColor Red
    exit 1
}

# 安装依赖（如果不存在 node_modules）
if (-not (Test-Path "node_modules")) {
    Write-Host "[1/2] 安装依赖..." -ForegroundColor Yellow
    bun install
}

switch ($Platform.ToLower()) {
    "desktop" {
        Write-Host "启动桌面端开发服务器..." -ForegroundColor Green
        Write-Host "快捷键:" -ForegroundColor Gray
        Write-Host "  Ctrl+C - 停止服务器" -ForegroundColor Gray
        Write-Host ""
        bun run tauri dev
    }

    "android" {
        Write-Host "启动 Android 开发模式..." -ForegroundColor Green
        Write-Host ""

        # 设置 Java 17
        $JAVA_17_PATH = "D:\data\AndroidStudioSDK\java17"

        if (Test-Path $JAVA_17_PATH) {
            $env:JAVA_HOME = $JAVA_17_PATH
            $env:PATH = "$JAVA_17_PATH\bin;$env:PATH"

            $javaVersion = & java -version 2>&1 | Select-String "version" | ForEach-Object { $_.ToString() }
            Write-Host "使用 Java: $javaVersion" -ForegroundColor Green
            Write-Host ""
        } else {
            Write-Host "警告: 找不到 Java 17，使用系统默认 Java" -ForegroundColor Yellow
        }

        Write-Host "启动 Android 开发服务器..." -ForegroundColor Green
        Write-Host "确保已连接 Android 设备或启动了模拟器" -ForegroundColor Yellow
        Write-Host "快捷键:" -ForegroundColor Gray
        Write-Host "  Ctrl+C - 停止服务器" -ForegroundColor Gray
        Write-Host ""
        bun run tauri android dev
    }

    default {
        Write-Host "未知平台: $Platform" -ForegroundColor Red
        Write-Host "用法:" -ForegroundColor Yellow
        Write-Host "  .\dev.ps1 desktop  - 启动桌面端开发" -ForegroundColor Yellow
        Write-Host "  .\dev.ps1 android  - 启动 Android 开发" -ForegroundColor Yellow
        exit 1
    }
}
