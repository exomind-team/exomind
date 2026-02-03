# Tauri Android 构建脚本
# 用法: .\build-android.ps1
# 自动设置 Java 17 环境变量

$ErrorActionPreference = "Stop"

# 环境变量配置
$JAVA_17_PATH = "D:\data\AndroidStudioSDK\java17"

# 检查 Java 17 是否存在
if (-not (Test-Path $JAVA_17_PATH)) {
    Write-Host "错误: 找不到 Java 17 路径: $JAVA_17_PATH" -ForegroundColor Red
    Write-Host "请确认路径正确后重新运行脚本" -ForegroundColor Red
    exit 1
}

# 设置环境变量
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Tauri Android Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[0/5] 设置环境变量..." -ForegroundColor Yellow

# 保存原始环境变量
$env:ORIGINAL_JAVA_HOME = $env:JAVA_HOME
$env:ORIGINAL_PATH = $env:PATH

# 设置 Java 17
$env:JAVA_HOME = $JAVA_17_PATH
$env:PATH = "$JAVA_17_PATH\bin;$env:PATH"

# 验证 Java 版本
$javaVersion = java -version 2>&1 | Select-String "version"
Write-Host "      Java: $javaVersion" -ForegroundColor Green

# 检查项目目录
Write-Host "[1/5] 检查项目结构..." -ForegroundColor Yellow

if (-not (Test-Path "src-tauri")) {
    Write-Host "错误: 请在项目根目录运行此脚本" -ForegroundColor Red
    exit 1
}

# 检查 Android 项目是否初始化
if (-not (Test-Path "src-tauri/gen/android")) {
    Write-Host "错误: Android 项目未初始化" -ForegroundColor Red
    Write-Host "请先运行: bun run tauri android init" -ForegroundColor Yellow
    exit 1
}

Write-Host "      项目检查通过" -ForegroundColor Green

# 清理旧的构建产物
Write-Host "[2/5] 清理旧构建产物..." -ForegroundColor Yellow

# 清理 Rust target 中的 Android 构建
$androidTargetPaths = @(
    "src-tauri/target/aarch64-linux-android",
    "src-tauri/target/armv7-linux-androideabi",
    "src-tauri/target/i686-linux-android",
    "src-tauri/target/x86_64-linux-android"
)

foreach ($path in $androidTargetPaths) {
    if (Test-Path $path) {
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
        Write-Host "      已清理 $path" -ForegroundColor DarkGray
    }
}

Write-Host "      清理完成" -ForegroundColor Green

# 安装依赖
Write-Host "[3/5] 安装依赖..." -ForegroundColor Yellow
try {
    bun install
    Write-Host "      依赖安装完成" -ForegroundColor Green
} catch {
    Write-Host "      依赖安装失败: $_" -ForegroundColor Red
    exit 1
}

# 构建前端
Write-Host "[4/5] 构建前端..." -ForegroundColor Yellow
try {
    bun run build
    Write-Host "      前端构建完成" -ForegroundColor Green
} catch {
    Write-Host "      前端构建失败: $_" -ForegroundColor Red
    exit 1
}

# 构建 Android APK/AAB
Write-Host "[5/5] 构建 Android 应用..." -ForegroundColor Yellow
Write-Host "      这可能需要几分钟，请耐心等待..." -ForegroundColor Gray

try {
    bun run tauri android build --apk
    Write-Host "      Android 构建完成" -ForegroundColor Green
} catch {
    Write-Host "      Android 构建失败: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "常见解决方案:" -ForegroundColor Yellow
    Write-Host "  1. 确保 Android SDK 和 NDK 已正确安装" -ForegroundColor Yellow
    Write-Host "  2. 运行: bun run tauri android dev 测试开发版" -ForegroundColor Yellow
    Write-Host "  3. 检查 src-tauri/gen/android 是否存在" -ForegroundColor Yellow
    exit 1
}

# 恢复原始环境变量
$env:JAVA_HOME = $env:ORIGINAL_JAVA_HOME
$env:PATH = $env:ORIGINAL_PATH

# 显示结果
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Android 构建成功!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# 查找生成的 APK 文件
$apkDir = "src-tauri/gen/android/app/build/outputs/apk"
if (Test-Path $apkDir) {
    $apkFiles = Get-ChildItem -Path $apkDir -Recurse -Filter "*.apk" -ErrorAction SilentlyContinue
    if ($apkFiles) {
        Write-Host "输出文件:" -ForegroundColor Cyan
        foreach ($apk in $apkFiles) {
            $sizeMB = [math]::Round($apk.Length / 1MB, 2)
            Write-Host "  $($apk.FullName) (${sizeMB} MB)" -ForegroundColor White
        }
    } else {
        Write-Host "APK 文件位置: $apkDir" -ForegroundColor Gray
    }
} else {
    Write-Host "APK 文件位置: $apkDir" -ForegroundColor Gray
}

Write-Host ""
Write-Host "安装到设备:" -ForegroundColor Cyan
Write-Host "  adb install -r src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Gray
Write-Host ""

# 询问是否安装到设备
$install = Read-Host "是否安装到已连接的 Android 设备? (y/n)"
if ($install -eq "y" -or $install -eq "Y") {
    try {
        $debugApk = "src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk"
        if (Test-Path $debugApk) {
            adb install -r $debugApk
            Write-Host "安装完成!" -ForegroundColor Green
        } else {
            Write-Host "找不到调试版 APK" -ForegroundColor Red
        }
    } catch {
        Write-Host "安装失败: $_" -ForegroundColor Red
        Write-Host "请确保设备已连接且开启了 USB 调试" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
