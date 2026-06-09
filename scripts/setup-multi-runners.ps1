# ExoMind 多 Runner 共享缓存配置脚本
# 用途：在一台 Windows 机器上配置多个 GitHub Actions Runner，共享缓存目录

param(
    [Parameter(Mandatory=$true)]
    [string]$GithubToken,

    [Parameter(Mandatory=$false)]
    [int]$RunnerCount = 8,  # 默认 8 个 Runner

    [Parameter(Mandatory=$false)]
    [string]$BaseDir = "D:\github-runners",

    [Parameter(Mandatory=$false)]
    [string]$RepoUrl = "https://github.com/你的用户名/exomind",

    [Parameter(Mandatory=$false)]
    [hashtable]$RunnerLabels = @{
        1 = "self-hosted,Windows,X64,builder,android"
        2 = "self-hosted,Windows,X64,builder,windows"
        3 = "self-hosted,Windows,X64,builder,linux"
        4 = "self-hosted,Windows,X64,builder,backup"
        5 = "self-hosted,Windows,X64,uploader"
        6 = "self-hosted,Windows,X64,uploader"
        7 = "self-hosted,Windows,X64,general"
        8 = "self-hosted,Windows,X64,general"
    }
)

# 检查管理员权限
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "此脚本需要管理员权限运行"
    exit 1
}

Write-Host "=== ExoMind 多 Runner 配置脚本 ===" -ForegroundColor Cyan

# 1. 创建目录结构
Write-Host "`n[1/6] 创建目录结构..." -ForegroundColor Yellow
$dirs = @(
    "$BaseDir\shared\cache\bun",
    "$BaseDir\shared\cache\cargo",
    "$BaseDir\workspaces",
    "$BaseDir\runners"
)
foreach ($dir in $dirs) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Write-Host "  ✓ 创建: $dir" -ForegroundColor Green
}

# 2. 设置全局环境变量
Write-Host "`n[2/6] 设置全局环境变量..." -ForegroundColor Yellow
[System.Environment]::SetEnvironmentVariable("BUN_INSTALL_CACHE_DIR", "$BaseDir\shared\cache\bun", "Machine")
[System.Environment]::SetEnvironmentVariable("CARGO_HOME", "$BaseDir\shared\cache\cargo", "Machine")
Write-Host "  ✓ BUN_INSTALL_CACHE_DIR = $BaseDir\shared\cache\bun" -ForegroundColor Green
Write-Host "  ✓ CARGO_HOME = $BaseDir\shared\cache\cargo" -ForegroundColor Green

# 3. 下载 GitHub Actions Runner
Write-Host "`n[3/6] 下载 GitHub Actions Runner..." -ForegroundColor Yellow
$runnerVersion = "2.314.1"
$runnerZip = "$BaseDir\actions-runner.zip"
if (-not (Test-Path $runnerZip)) {
    $downloadUrl = "https://github.com/actions/runner/releases/download/v$runnerVersion/actions-runner-win-x64-$runnerVersion.zip"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $runnerZip
    Write-Host "  ✓ 下载完成: $runnerZip" -ForegroundColor Green
} else {
    Write-Host "  ✓ 已存在: $runnerZip" -ForegroundColor Green
}

# 4. 配置多个 Runner
Write-Host "`n[4/6] 配置 $RunnerCount 个 Runner..." -ForegroundColor Yellow
for ($i = 1; $i -le $RunnerCount; $i++) {
    $runnerId = "runner-$i"
    $runnerDir = "$BaseDir\runners\$runnerId"
    $workspaceDir = "$BaseDir\workspaces\$runnerId"

    Write-Host "`n  配置 $runnerId..." -ForegroundColor Cyan

    # 解压 Runner
    if (-not (Test-Path "$runnerDir\config.cmd")) {
        New-Item -ItemType Directory -Force -Path $runnerDir | Out-Null
        Expand-Archive -Path $runnerZip -DestinationPath $runnerDir -Force
        Write-Host "    ✓ 解压 Runner" -ForegroundColor Green
    }

    # 配置 Runner
    cd $runnerDir
    $labels = if ($RunnerLabels.ContainsKey($i)) {
        $RunnerLabels[$i]
    } else {
        "self-hosted,Windows,X64,runner-$i"
    }
    .\config.cmd --url $RepoUrl --token $GithubToken --name $runnerId --labels $labels --work $workspaceDir --unattended
    Write-Host "    ✓ 配置完成: $runnerId (标签: $labels)" -ForegroundColor Green

    # 安装为服务
    .\svc.cmd install
    Write-Host "    ✓ 安装为服务" -ForegroundColor Green
}

# 5. 初始化工作区
Write-Host "`n[5/6] 初始化工作区..." -ForegroundColor Yellow
for ($i = 1; $i -le $RunnerCount; $i++) {
    $runnerId = "runner-$i"
    $workspaceDir = "$BaseDir\workspaces\$runnerId\exomind"

    if (-not (Test-Path $workspaceDir)) {
        Write-Host "  克隆代码到 $runnerId..." -ForegroundColor Cyan
        git clone $RepoUrl $workspaceDir

        cd $workspaceDir
        Write-Host "  安装依赖..." -ForegroundColor Cyan
        bun install

        Write-Host "    ✓ $runnerId 工作区初始化完成" -ForegroundColor Green
    } else {
        Write-Host "    ✓ $runnerId 工作区已存在" -ForegroundColor Green
    }
}

# 6. 启动所有 Runner
Write-Host "`n[6/6] 启动所有 Runner..." -ForegroundColor Yellow
for ($i = 1; $i -le $RunnerCount; $i++) {
    $runnerId = "runner-$i"
    $runnerDir = "$BaseDir\runners\$runnerId"

    cd $runnerDir
    .\svc.cmd start
    Write-Host "  ✓ 启动: $runnerId" -ForegroundColor Green
}

# 完成
Write-Host "`n=== 配置完成 ===" -ForegroundColor Cyan
Write-Host "Runner 数量: $RunnerCount" -ForegroundColor Green
Write-Host "基础目录: $BaseDir" -ForegroundColor Green
Write-Host "共享缓存: $BaseDir\shared\cache" -ForegroundColor Green
Write-Host "`n查看 Runner 状态:" -ForegroundColor Yellow
Write-Host "  Get-Service | Where-Object {`$_.Name -like '*actions.runner*'}" -ForegroundColor Gray
Write-Host "`n停止所有 Runner:" -ForegroundColor Yellow
Write-Host "  Get-Service | Where-Object {`$_.Name -like '*actions.runner*'} | Stop-Service" -ForegroundColor Gray
Write-Host "`n启动所有 Runner:" -ForegroundColor Yellow
Write-Host "  Get-Service | Where-Object {`$_.Name -like '*actions.runner*'} | Start-Service" -ForegroundColor Gray
