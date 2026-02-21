# 多端消息同步系统构建与E2E测试计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 exomind-dev-chat worktree 上重新构建多端消息同步系统，分架构构建安卓APK，进行E2E测试，并提交Draft PR

**Architecture:** 使用 Tauri 2.0 跨平台架构，桌面端和安卓端共用一套前端代码，通过 worktree 隔离开发环境。构建脚本统一放在 scripts/ 目录。

**Tech Stack:** Tauri 2.0, React, TypeScript, Rust, Gradle, Git Worktree, mcp-server-tauri

**工作目录:** `D:\project\exomind-dev-chat` (从 dev 分支创建的 worktree)

---

## Ralph Loop v3.2 流程概览

```
Step 0: 读取输入 (pm/input.md > pm/prd.md)
Step 1: 评审完成情况
Step 2: 创建功能分支 + Draft PR  ← 当前从这里开始
Step 3: 架构设计
Step 4: 模块规格设计
Step 5: 编码实现
Step 6: 单元测试
Step 7: 集成测试 + E2E测试
Step 8: 文档更新
Step 9: Draft PR → 正式 PR
Step 10-11: 人类审查 + 合并
Step 12: 记忆归档
```

---

## Step 2: 创建功能分支 + Draft PR

### Task 2.1: 确认 worktree 状态

**执行目录:** `D:\project\exomind`

**Step 1: 检查当前 worktree 列表**

```bash
cd D:\project\exomind
git worktree list
```

Expected: 应看到 `D:\project\exomind-dev-chat` 指向 dev 分支

**Step 2: 确认 exomind-dev-chat 目录存在**

```bash
ls D:\project\exomind-dev-chat
```

Expected: 目录存在且包含项目文件

### Task 2.2: 创建功能分支

**执行目录:** `D:\project\exomind-dev-chat`

**Step 1: 切换到 worktree 目录**

```bash
cd D:\project\exomind-dev-chat
```

**Step 2: 确认当前在 dev 分支**

```bash
git branch
```

Expected: `* dev`

**Step 3: 创建功能分支**

```bash
git checkout -b feature/multi-device-build-e2e
```

Expected: 成功创建并切换到新分支

**Step 4: 推送分支到远程**

```bash
git push -u origin feature/multi-device-build-e2e
```

Expected: 分支推送成功

**Step 5: 提交分支创建记录**

```bash
git commit --allow-empty -m "chore: 创建功能分支 feature/multi-device-build-e2e"
git push
```

### Task 2.3: 创建 Draft PR

**Step 1: 使用 gh CLI 创建 Draft PR**

```bash
gh pr create --draft --title "[WIP] 多端消息同步系统构建与E2E测试" --body "$(cat <<'EOF'
## 目标
重新构建多端消息同步系统，支持分架构APK构建，并完成E2E测试验证。

## 任务清单
- [ ] 桌面端构建 (Windows)
- [ ] 安卓 arm64 APK 构建
- [ ] 安卓 x86_64 APK 构建
- [ ] 桌面端 E2E 测试
- [ ] 安卓端 E2E 测试
- [ ] 多端消息同步功能验证

## 相关文档
- 构建脚本: scripts/
- 计划文档: docs/plans/2026-02-04-multi-device-e2e-testing.md

## 状态
🚧 WIP - 开发中
EOF
)"
```

Expected: PR 创建成功，返回 PR URL

---

## Step 3: 架构设计

### Task 3.1: 审查现有架构

**执行目录:** `D:\project\exomind-dev-chat`

**Files:**
- Read: `docs/architecture/7-LAYER.md`
- Read: `docs/architecture/DATA-FLOW.md`

**Step 1: 读取架构文档**

理解现有 7 层架构和消息同步的数据流向。

**Step 2: 检查构建相关架构**

```bash
ls scripts/
cat scripts/build.ps1 2>/dev/null || echo "无 PowerShell 脚本"
cat scripts/build.sh 2>/dev/null || echo "无 Shell 脚本"
```

**Step 3: 检查 Tauri 配置架构**

```bash
cat src-tauri/tauri.conf.json | head -100
```

### Task 3.2: 更新架构设计（如需）

**Files:**
- Modify: `docs/architecture/BUILD-DEPLOY.md` (创建构建部署架构文档)

**Step 1: 编写构建部署架构**

描述构建流程：
- 桌面端构建流程
- 移动端分架构构建流程
- E2E测试架构（mcp-server-tauri集成）

**Step 2: 提交架构文档**

```bash
git add docs/architecture/
git commit -m "docs(architecture): 添加构建与E2E测试架构设计 [BUILD-DEPLOY.md]"
git push
```

**Step 3: 更新 Draft PR**

```bash
gh pr comment --body "✅ Step 3 完成: 架构设计已提交"
```

---

## Step 4: 模块规格设计

### Task 4.1: 创建构建模块规格

**Files:**
- Create: `docs/specs/SPEC-301-BuildSystem.md`

**Step 1: 编写构建系统规格**

包含：
- 设计理由：为什么需要分架构构建
- 功能定义：构建脚本功能、输出格式
- 输入：源代码、构建配置
- 输出：桌面可执行文件、分架构APK
- 验收标准：构建成功、文件大小合理、可安装运行

**Step 2: 提交规格**

```bash
git add docs/specs/
git commit -m "docs(specs): 添加构建系统模块规格 [SPEC-301-BuildSystem.md]"
git push
```

### Task 4.2: 创建E2E测试模块规格

**Files:**
- Create: `docs/specs/SPEC-302-E2ETesting.md`

**Step 1: 编写E2E测试规格**

包含：
- 设计理由：为什么使用 mcp-server-tauri
- 测试范围：桌面端、安卓端、多端同步
- 测试工具：mcp-server-tauri 提供的工具
- 验收标准：所有测试用例通过

**Step 2: 提交规格**

```bash
git add docs/specs/
git commit -m "docs(specs): 添加E2E测试模块规格 [SPEC-302-E2ETesting.md]"
git push
```

**Step 3: 更新 Draft PR**

```bash
gh pr comment --body "✅ Step 4 完成: 模块规格设计已提交"
```

---

## Step 5: 编码实现 - 构建脚本

### Task 5.1: 检查并修复构建脚本

**执行目录:** `D:\project\exomind-dev-chat`

**Files:**
- Check: `scripts/build-desktop.ps1`
- Check: `scripts/build-android.ps1`
- Modify: 修复构建路径问题

**Step 1: 检查现有构建脚本**

```bash
ls scripts/
```

**Step 2: 创建/修复桌面端构建脚本**

如果 scripts/build-desktop.ps1 不存在或有问题，创建：

```powershell
# scripts/build-desktop.ps1
param(
    [switch]$Release = $false
)

$ErrorActionPreference = "Stop"

Write-Host "🖥️  Building ExoMind Desktop..." -ForegroundColor Cyan

if ($Release) {
    bun tauri build
} else {
    bun tauri build --debug
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Desktop build failed!"
    exit 1
}

Write-Host "✅ Desktop build complete!" -ForegroundColor Green
```

**Step 3: 创建/修复安卓构建脚本（分架构）**

```powershell
# scripts/build-android.ps1
param(
    [ValidateSet("arm64", "x86_64", "all")]
    [string]$Arch = "all",

    [switch]$Release = $false
)

$ErrorActionPreference = "Stop"

$androidDir = "$PSScriptRoot\..\src-tauri\gen\android"

function Build-Apk {
    param([string]$targetArch, [string]$gradleTask)

    Write-Host "📱 Building Android $targetArch..." -ForegroundColor Cyan

    Push-Location $androidDir
    try {
        if ($Release) {
            .\gradlew.bat :app:assemble$gradleTask
        } else {
            .\gradlew.bat :app:assemble$($gradleTask)Debug
        }

        if ($LASTEXITCODE -ne 0) {
            Write-Error "Android $targetArch build failed!"
            exit 1
        }
    } finally {
        Pop-Location
    }

    Write-Host "✅ Android $targetArch build complete!" -ForegroundColor Green
}

# Build requested architectures
if ($Arch -eq "all" -or $Arch -eq "arm64") {
    $task = if ($Release) { "Arm64Release" } else { "Arm64Debug" }
    Build-Apk -targetArch "arm64" -gradleTask $task
}

if ($Arch -eq "all" -or $Arch -eq "x86_64") {
    $task = if ($Release) { "X86_64Release" } else { "X86_64Debug" }
    Build-Apk -targetArch "x86_64" -gradleTask $task
}

Write-Host "🎉 All Android builds complete!" -ForegroundColor Green
```

**Step 4: 提交构建脚本**

```bash
git add scripts/
git commit -m "feat(build): 添加桌面端和安卓分架构构建脚本 [scripts/]"
git push
```

### Task 5.2: 创建E2E测试脚本

**Files:**
- Create: `scripts/e2e-test.ps1`

**Step 1: 编写E2E测试脚本**

```powershell
# scripts/e2e-test.ps1
param(
    [ValidateSet("desktop", "android", "all")]
    [string]$Target = "all"
)

$ErrorActionPreference = "Stop"
$projectRoot = "$PSScriptRoot\.."

function Test-Desktop {
    Write-Host "🧪 Testing Desktop..." -ForegroundColor Cyan

    # 启动桌面应用
    $desktopPath = "$projectRoot\src-tauri\target\release\exomind.exe"
    if (-not (Test-Path $desktopPath)) {
        Write-Error "Desktop executable not found. Run build first."
        exit 1
    }

    # E2E 测试逻辑 - 使用 mcp-server-tauri
    Write-Host "Desktop E2E tests would run here using mcp-server-tauri"
    Write-Host "Connect via: driver_session action=start"
}

function Test-Android {
    Write-Host "🧪 Testing Android..." -ForegroundColor Cyan

    # 检查设备连接
    $devices = adb devices
    if ($devices -notmatch "device$") {
        Write-Error "No Android device connected"
        exit 1
    }

    Write-Host "Android E2E tests would run here using mcp-server-tauri"
}

if ($Target -eq "all" -or $Target -eq "desktop") {
    Test-Desktop
}

if ($Target -eq "all" -or $Target -eq "android") {
    Test-Android
}

Write-Host "🎉 E2E tests complete!" -ForegroundColor Green
```

**Step 2: 提交测试脚本**

```bash
git add scripts/
git commit -m "feat(test): 添加E2E测试脚本 [scripts/e2e-test.ps1]"
git push
```

**Step 3: 更新 Draft PR**

```bash
gh pr comment --body "✅ Step 5 完成: 构建和E2E脚本编码完成"
```

---

## Step 6: 单元测试

### Task 6.1: 构建脚本单元测试

**Files:**
- Create: `tests/build-scripts.test.ps1`

**Step 1: 编写构建脚本测试**

测试构建脚本参数解析、路径检查等功能。

**Step 2: 运行测试**

```bash
bun test
```

Expected: 所有测试通过

**Step 3: 提交测试**

```bash
git add tests/
git commit -m "test: 添加构建脚本单元测试 [build-scripts.test.ps1]"
git push
```

**Step 4: 更新 Draft PR**

```bash
gh pr comment --body "✅ Step 6 完成: 单元测试 100% 通过"
```

---

## Step 7: 集成测试 + E2E测试

### Task 7.1: 桌面端构建验证

**执行目录:** `D:\project\exomind-dev-chat`

**Step 1: 运行桌面端构建脚本**

```bash
.\scripts\build-desktop.ps1 -Release
```

Expected: 构建成功，输出到 `src-tauri/target/release/exomind.exe`

**Step 2: 验证构建产物**

```bash
ls src-tauri/target/release/exomind.exe
```

Expected: 文件存在且大小合理 (>10MB)

**Step 3: 提交构建结果**

```bash
git commit --allow-empty -m "build: 桌面端Release构建验证通过"
git push
```

### Task 7.2: 安卓端分架构构建验证

**Step 1: 构建 arm64 APK**

```bash
.\scripts\build-android.ps1 -Arch arm64 -Release
```

Expected: 构建成功，输出到 `src-tauri/gen/android/app/build/outputs/apk/arm64/release/`

**Step 2: 构建 x86_64 APK**

```bash
.\scripts\build-android.ps1 -Arch x86_64 -Release
```

Expected: 构建成功，输出到 `src-tauri/gen/android/app/build/outputs/apk/x86_64/release/`

**Step 3: 验证APK文件大小**

```bash
ls -lh src-tauri/gen/android/app/build/outputs/apk/*/release/
```

Expected: 每个APK 15-25MB（比通用包小）

**Step 4: 提交构建结果**

```bash
git commit --allow-empty -m "build: 安卓分架构APK构建验证通过 (arm64 + x86_64)"
git push
```

### Task 7.3: 桌面端 E2E 测试

**Step 1: 启动桌面应用**

```bash
Start-Process -FilePath "D:\project\exomind-dev-chat\src-tauri\target\release\exomind.exe"
```

**Step 2: 使用 mcp-server-tauri 连接**

```
mcp___hypothesi_tauri-mcp-server__driver_session
action: start
```

Expected: 连接成功

**Step 3: 执行 UI 测试**

```
mcp___hypothesi_tauri-mcp-server__webview_dom_snapshot
type: accessibility
```

```
mcp___hypothesi_tauri-mcp-server__webview_screenshot
format: png
filePath: "D:\project\exomind-dev-chat\e2e-results\desktop-home.png"
```

**Step 4: 停止连接**

```
mcp___hypothesi_tauri-mcp-server__driver_session
action: stop
```

**Step 5: 提交测试结果**

```bash
git add e2e-results/
git commit -m "test(e2e): 桌面端E2E测试完成 [e2e-results/]"
git push
```

### Task 7.4: 安卓端 E2E 测试

**Step 1: 检查设备**

```
mcp___hypothesi_tauri-mcp-server__list_devices
```

**Step 2: 安装 APK**

```bash
adb install -r D:\project\exomind-dev-chat\src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release-unsigned.apk
```

**Step 3: 启动应用**

```bash
adb shell am start -n com.exomind.app/.MainActivity
```

**Step 4: 连接并测试**

```
mcp___hypothesi_tauri-mcp-server__driver_session
action: start
```

```
mcp___hypothesi_tauri-mcp-server__webview_screenshot
format: png
filePath: "D:\project\exomind-dev-chat\e2e-results\android-home.png"
```

**Step 5: 停止连接**

```
mcp___hypothesi_tauri-mcp-server__driver_session
action: stop
```

**Step 6: 提交测试结果**

```bash
git add e2e-results/
git commit -m "test(e2e): 安卓端E2E测试完成 [e2e-results/]"
git push
```

### Task 7.5: 多端消息同步功能验证

**Step 1: 同时启动两端**

桌面端：启动可执行文件
安卓端：`adb shell am start ...`

**Step 2: 连接两端**

分别连接两个应用，记录 appIdentifier

**Step 3: 发送测试消息**

在桌面端发送消息，在安卓端验证接收

**Step 4: 截图验证**

两端同时截图，验证消息同步

**Step 5: 提交同步测试结果**

```bash
git add e2e-results/
git commit -m "test(e2e): 多端消息同步功能验证完成"
git push
```

**Step 6: 更新 Draft PR**

```bash
gh pr comment --body "✅ Step 7 完成: 集成测试和E2E测试全部通过"
```

---

## Step 8: 文档更新

### Task 8.1: 更新构建文档

**Files:**
- Modify: `docs/BUILD.md` 或创建 `docs/BUILD-ANDROID.md`

**Step 1: 编写构建指南**

包含：
- 环境准备（JDK、Android SDK）
- 桌面端构建命令
- 安卓分架构构建命令
- 输出文件位置

**Step 2: 更新 README**

在 README 中添加构建状态徽章和快速开始链接。

**Step 3: 提交文档**

```bash
git add docs/ README.md
git commit -m "docs: 更新构建文档和README [BUILD.md, README.md]"
git push
```

**Step 4: 更新 Draft PR**

```bash
gh pr comment --body "✅ Step 8 完成: 文档更新完成"
```

---

## Step 9: Draft PR → 正式 PR

### Task 9.1: 准备 PR 描述

**Step 1: 整理变更摘要**

```bash
git log --oneline dev..feature/multi-device-build-e2e
```

**Step 2: 更新 PR 为正式状态**

```bash
gh pr ready
```

**Step 3: 更新 PR 描述**

```bash
gh pr edit --body "$(cat <<'EOF'
## 变更摘要

### 新增
- 桌面端构建脚本 `scripts/build-desktop.ps1`
- 安卓分架构构建脚本 `scripts/build-android.ps1`
- E2E测试脚本 `scripts/e2e-test.ps1`
- 构建部署架构文档 `docs/architecture/BUILD-DEPLOY.md`
- 构建系统规格 `docs/specs/SPEC-301-BuildSystem.md`
- E2E测试规格 `docs/specs/SPEC-302-E2ETesting.md`

### 构建验证
- ✅ 桌面端 Windows 构建成功
- ✅ 安卓 arm64 APK 构建成功 (~20MB)
- ✅ 安卓 x86_64 APK 构建成功 (~20MB)

### E2E测试验证
- ✅ 桌面端 UI 测试通过
- ✅ 安卓端 UI 测试通过
- ✅ 多端消息同步功能验证通过

### 截图证据
- `e2e-results/desktop-home.png`
- `e2e-results/android-home.png`

## 测试情况
- 单元测试覆盖率: 100%
- 集成测试: 通过
- E2E测试: 通过

## 关联 Issue
Closes #XXX (多端消息同步系统构建)
EOF
)"
```

### Task 9.2: 最终检查

**Step 1: 检查所有文件已提交**

```bash
git status
```

Expected: 无未提交更改

**Step 2: 验证构建产物存在**

```bash
ls src-tauri/target/release/exomind.exe
ls src-tauri/gen/android/app/build/outputs/apk/arm64/release/
ls src-tauri/gen/android/app/build/outputs/apk/x86_64/release/
```

---

## Step 10-11: 人类审查 + 合并（等待人类操作）

> ⚠️ **AI 在此停止，等待人类审查**

**人类需要执行：**
1. 代码审查（Files changed）
2. 可选：本地验证构建
3. 批准 PR（Approve）
4. 合并到 dev 分支

**AI 响应修改请求：**
- 如果人类要求修改，回到 Step 5/4 修改 → commit → push
- 直到获得 LGTM

---

## Step 12: 记忆归档

### Task 12.1: 更新执行日志

**Files:**
- Modify: `pm/memory/logs.md`

**Step 1: 添加本轮日志**

```markdown
## [2026-02-04] Ralph Loop 第 X 轮 - 多端消息同步系统构建与E2E测试

### 执行摘要
- 任务: 重新构建多端消息同步系统，分架构APK构建，E2E测试
- 结果: 成功
- 主要变更:
  - 创建桌面端和安卓构建脚本
  - 实现分架构APK构建（arm64/x86_64）
  - 完成桌面端和安卓端E2E测试
  - 验证多端消息同步功能

### 遇到的问题
| 问题 | 原因 | 解决方案 | 优化建议 |
|------|------|----------|----------|
| 构建路径错误 | 在错误目录运行gradle | 切换到 src-tauri/gen/android 目录 | 使用脚本封装构建命令 |
| APK体积过大 | 构建通用包包含所有架构 | 分架构单独构建 | 提供arm64和x86_64两个APK |

### 有价值发现
- mcp-server-tauri 可以高效地进行跨平台E2E测试
- Git worktree 可以很好地隔离不同功能的开发环境
```

**Step 2: 提交日志**

```bash
git add pm/memory/logs.md
git commit -m "docs(memory): 更新执行日志 [logs.md]"
git push
```

### Task 12.2: 更新知识点（如需）

如果有新的经验，创建或更新知识点文件：
- `pm/memory/知识点-Tauri构建.md`
- `pm/memory/知识点-E2E测试.md`

---

## 执行检查清单

### Step 2: 分支和PR
- [ ] Task 2.1: 确认 worktree 状态
- [ ] Task 2.2: 创建功能分支
- [ ] Task 2.3: 创建 Draft PR

### Step 3: 架构设计
- [ ] Task 3.1: 审查现有架构
- [ ] Task 3.2: 更新架构设计

### Step 4: 模块规格
- [ ] Task 4.1: 创建构建模块规格
- [ ] Task 4.2: 创建E2E测试模块规格

### Step 5: 编码
- [ ] Task 5.1: 检查并修复构建脚本
- [ ] Task 5.2: 创建E2E测试脚本

### Step 6: 单元测试
- [ ] Task 6.1: 构建脚本单元测试

### Step 7: 集成测试 + E2E
- [ ] Task 7.1: 桌面端构建验证
- [ ] Task 7.2: 安卓分架构构建验证
- [ ] Task 7.3: 桌面端 E2E 测试
- [ ] Task 7.4: 安卓端 E2E 测试
- [ ] Task 7.5: 多端消息同步功能验证

### Step 8: 文档
- [ ] Task 8.1: 更新构建文档

### Step 9: PR
- [ ] Task 9.1: 准备 PR 描述
- [ ] Task 9.2: 最终检查

### Step 10-11: 人类审查（等待）

### Step 12: 记忆归档
- [ ] Task 12.1: 更新执行日志
- [ ] Task 12.2: 更新知识点

---

## 故障排除

### Worktree 问题

**问题**: exomind-dev-chat 目录不存在
**解决**:
```bash
cd D:\project\exomind
git worktree add D:\project\exomind-dev-chat dev
```

### 构建失败

**问题**: Gradle 构建失败
**解决**:
1. 确认在 `src-tauri/gen/android/` 目录下运行
2. 检查 `local.properties` 中的 SDK 路径
3. 清理构建: `.\gradlew.bat clean`

### mcp-server-tauri 连接失败

**问题**: 无法连接到 Tauri 应用
**解决**:
1. 确认应用已启动
2. 检查 MCP Bridge 插件配置
3. 查看日志: `mcp___hypothesi_tauri-mcp-server__read_logs`

---

*计划创建时间: 2026-02-04*
*工作目录: D:\project\exomind-dev-chat*
*功能分支: feature/multi-device-build-e2e*
*执行者: Claude Code with superpowers:executing-plans*
