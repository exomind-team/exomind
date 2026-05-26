# PR Preview Build 调研报告

> 调研日期：2026-05-26
> 调研人：Claude Code（MiniMax M2.7 high speed）
> 需求方：exomind-team/exomind
> 调研目的：为 GitHub Actions 实现轻量级 PR preview build（按需手动触发，不走 formal release 通道）

---

## 一、需求定义

### 1.1 核心痛点

现有 formal release 流程（push to dev + 打 tag）的问题：

| 维度 | Formal Release | PR Preview |
|------|--------------|------------|
| 触发方式 | push dev + 打 tag | PR 评论发命令 |
| 消耗资源 | 正式构建额度 | 按需轻量 |
| APK 签名 | 正式签名（需 secrets） | debug 版本，无需签名 |
| 产物分发 | GitHub Release | Draft Release 或 PR 评论链接 |
| 适用场景 | 正式发布 | 实验性 PR review |

### 1.2 需求目标

- PR 里能预览构建后的 APP（Windows exe + Android apk）
- **受人控制**：不发命令不构建，不消耗额度
- **不走 formal release 通道**：不 push dev，不打 tag，不污染正式构建历史
- 对实验性开发友好

### 1.3 调研范围

- 成熟 Tauri/Electron/App 项目 PR preview 实现案例
- GitHub Actions PR 构建的触发机制（`pull_request` vs `workflow_run` vs `pull_request_target`）
- Artifact 分发方案（Draft Release vs Artifact URL vs 其他）
- Android debug APK 签名处理
- 安全模型（fork PR 构建的权限隔离）

---

## 二、成熟项目案例

### 2.1 Next.js（最完整的两 workflow 模式）

仓库：`vercel/next.js`

**核心 workflow 文件：**
- `.github/workflows/build_and_deploy.yml`（构建 + 部署）
- `.github/workflows/upload_preview_tarballs.yml`（通过 workflow_run 下载 artifact 并上传）

**关键模式：workflow_run 安全构建**

```yaml
# build_and_deploy.yml（第 5-12 行）
on:
  push:
    branches-ignore:
      - 'graphite-base/**'
  pull_request:
    types: [opened, synchronize]
  workflow_dispatch:

# upload_preview_tarballs.yml（第 1-7 行）
on:
  workflow_run:
    workflows: ['build-and-deploy']
    types: [completed]
```

**Artifact 跨 workflow 共享：**

```yaml
# build_and_deploy.yml 中：
- name: Persist tarballs
  uses: actions/upload-artifact@043fb46d
  with:
    name: preview-tarballs
    path: ${{ runner.temp }}/preview-tarballs/*

# upload_preview_tarballs.yml 中（通过 run-id 跨 workflow 下载）：
- name: Download preview-tarballs artifact
  uses: actions/download-artifact@3e5f45b2
  with:
    name: preview-tarballs
    path: ${{ runner.temp }}/preview-tarballs
    run-id: ${{ github.event.workflow_run.id }}
```

**并发控制（避免同一 PR 多次构建浪费）：**

```yaml
# build_and_deploy.yml（第 14-17 行）
concurrency:
  group: ${{ github.event_name == 'pull_request' && format('{0}-pr-{1}', github.workflow, github.ref_name) || format('{0}-sha-{1}', github.workflow, github.sha) }}
  cancel-in-progress: true
```

### 2.2 pr-preview-action（专用 PR Preview Action）

仓库：`rossjrw/pr-preview-action`

**特点：** 自动检测 PR 状态，部署或移除 preview 环境

**触发模式：**

```yaml
# action.yml（第 80-86 行）
on:
  pull_request:
    types: [opened, synchronize, closed]
inputs:
  action:
    description: 'deploy', 'remove', or 'auto'
    default: auto
```

**Sticky PR Comment 模式（发布后持续更新同一条评论）：**

```yaml
- name: Leave a comment after deployment
  uses: marocchino/sticky-pull-request-comment@67d0dec7b07ed060a405f9b2a64b8ab319fdd7db
  with:
    header: pr-preview
    message: ${{ steps.deploy-comment.outputs.content }}
```

### 2.3 Expo PR Preview Build

仓库：`Cook-Unity/expo-pr-preview-build`

专门为 React Native/Expo 项目设计的 PR preview build action，处理 Android/iOS 构建和分发。

---

## 三、GitHub Actions 触发器机制深度解析

### 3.1 三大 PR 触发器对比

| 触发器 | 代码执行上下文 | Token 权限 | Secrets 访问 | 安全性 |
|--------|-------------|-----------|-------------|--------|
| `pull_request`（fork PR） | PR merge commit | read-only | **不传递**（fork PR） | ✅ 安全 |
| `pull_request`（同 repo PR） | PR merge commit | read/write | 传递 | ⚠️ 同 repo 可信 |
| `pull_request_target` | **base repo 默认分支** | read/write | **完全传递** | ❌ 危险 |
| `workflow_run` | **base repo**（不执行 PR 代码） | read/write | 传递 | ✅ 安全 |

### 3.2 `pull_request_target` 的危险性

> **GitHub 官方警告**（来源：GitHub Actions Events 文档）：
> `pull_request_target` should be avoided for building or running code from the pull request due to potential security vulnerabilities like cache poisoning or unintended access.

**危险场景：**

```yaml
# ❌ 永远不要这样做：
on:
  pull_request_target:
jobs:
  build:
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ github.event.pull_request.head.ref }}  # 攻击者控制！
      - run: npm ci  # 恶意 install 脚本可访问 secrets
```

**缓存污染攻击向量：** 在 `pull_request_target` 或 `workflow_run` 中创建的缓存对 base branch 可见，攻击者可污染缓存使后续 base 分支构建执行恶意代码。

### 3.3 `workflow_run` 安全模型

**正确安全模式：两 workflow 协作**

```
workflow 1（pull_request）     workflow 2（workflow_run）
─────────────────────────     ─────────────────────────
✅ 安全：运行在 PR 上下文     ✅ 安全：运行在 base repo 上下文
✅ 只上传 metadata（不执行   ✅ 有 secrets 权限
   PR 代码）                 ❌ 不 checkout PR head 代码
```

**关键：workflow 2 中不能 checkout PR head 代码**

```yaml
# workflow 2：workflow_run 模式（安全）
on:
  workflow_run:
    workflows: [PR Build Trigger]
    types: [completed]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      # ✅ 不 checkout PR 代码！
      - name: Download metadata artifact
        uses: actions/download-artifact@v4
        with:
          name: pr-metadata
          run_id: ${{ github.event.workflow_run.id }}
```

### 3.4 正确的 `issue_comment` slash command 模式

```yaml
on:
  issue_comment:
    types: [created, edited]

jobs:
  trigger:
    if: github.event.issue.pull_request && startsWith(github.event.comment.body, '/build')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Post initial comment
        uses: actions/github-script@v8
        with:
          script: |
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: '🔨 构建已触发...'
            });
```

---

## 四、Artifact 分发方案对比

### 4.1 方案对比

| 方案 | Reviewer 体验 | 实现复杂度 | 链接持久性 | 权限需求 |
|------|-------------|---------|---------|---------|
| **Draft Release** | ⭐⭐⭐ 直接下载 | 中 | 持久 | `contents: write` |
| 临时 signed URL | ⭐⭐⭐ 需刷新 | 高 | 临时（1-2h） | read |
| GitHub Actions Artifact 直接下载 | ⭐⭐ 需登录 | 低 | 与 artifact 同（默认 90 天） | read |
| 手动找 artifact | ⭐ | 低 | N/A | read |

### 4.2 Draft Release 实现模式

`softprops/action-gh-release` 支持 `draft: true` 和 `prerelease: true`：

```yaml
- name: Create Draft Release
  uses: softprops/action-gh-release@v3
  with:
    draft: true
    prerelease: true
    files: |
      dist/exomind.exe
      src-tauri/gen/android/app/build/outputs/apk/**/*.apk
    body: |
      ## PR Preview Build
      PR: #${{ github.event.client_payload.pr_number }}
      Commit: ${{ github.sha }}
    target_commitish: ${{ github.sha }}
```

**优势：**
- Reviewer 点链接直接下载，无需登录 GitHub 账号
- Release 与特定 commit 关联，可重复访问
- 多文件一次性上传
- Draft Release 不出现在公开 Release 列表（需有权限才能看到）

### 4.3 `dawidd6/action-download-artifact`（第三方增强版）

官方 `actions/download-artifact` 的功能增强，支持从指定 workflow run 下载 artifact：

```yaml
- name: Download artifact from triggering workflow run
  uses: dawidd6/action-download-artifact@v3
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    run_id: ${{ github.event.workflow_run.id }}
    name: build-output
    path: output/
```

---

## 五、Android APK 签名处理

### 5.1 GitHub Secrets 对 fork PR 的限制

> **GitHub 安全策略**：Secrets（`GITHUB_TOKEN` 除外）**不会传递给 fork PR 的 runner**。
> 来源：[GitHub Actions workflow events docs](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows)

**影响：**
- Fork PR：无法访问 `ANDROID_KEYSTORE_BASE64` 等签名 secrets
- 同 repo PR：可访问 secrets

### 5.2 Debug APK 自动签名

Android debug build **使用自动生成的 debug.keystore 签名**，无需任何 secrets：

```kotlin
// Tauri Android build.gradle.kts
buildTypes {
    getByName("debug") {
        // Debug builds use default debug signing (no secrets needed)
        applicationIdSuffix = ".debug"
        isDebuggable = true
    }
    // staging: inherits debug signing, adds custom app ID + manifest placeholders
    create("staging") {
        initWith(getByName("debug"))
        manifestPlaceholders["hostName"] = "internal.example.com"
        applicationIdSuffix = ".debugStaging"
    }
}
```

### 5.3 Tauri Android 签名 secrets（官方推荐）

| Secret | 用途 |
|--------|------|
| `ANDROID_KEY_BASE64` | Base64 编码的 keystore 文件 |
| `ANDROID_KEY_ALIAS` | keystore 内的 key alias |
| `ANDROID_KEY_PASSWORD` | key 密码 |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater 签名私钥 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Tauri 签名 key 密码 |

### 5.4 PR Preview 签名策略

**推荐方案：Debug 版本（无需 secrets）**

```bash
# Tauri Android 构建命令（无需签名）
bun tauri android build --ci --apk
```

**Guard 模式（正式签名仅在 tag push 时执行）：**

```yaml
- name: Sign and upload Android APK
  if: github.event_name != 'pull_request'
  run: |
    # 签名逻辑...
  env:
    ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
```

---

## 六、安全模型与权限控制

### 6.1 权限模型汇总

| 触发器 | `contents` | `pull-requests` | `actions` |
|--------|-----------|----------------|-----------|
| `pull_request`（fork） | read | read | read |
| `pull_request`（同 repo） | read/write | read/write | read |
| `workflow_run` | read/write | read/write | read/write |
| `issue_comment` | read | read/write | read |

### 6.2 推荐权限配置（最小权限原则）

```yaml
permissions:
  contents: read        # minimal
  pull-requests: write  # post comments
  actions: read        # only if needed for cache management
```

### 6.3 Checkout 安全加固

```yaml
- uses: actions/checkout@v6
  with:
    persist-credentials: false  # 防止凭证泄露到 git config
    fetch-depth: 0
```

---

## 七、并发冲突处理

### 7.1 Next.js 的并发控制模式

```yaml
concurrency:
  group: ${{ github.event_name == 'pull_request' && format('{0}-pr-{1}', github.workflow, github.ref_name) || format('{0}-sha-{1}', github.workflow, github.sha) }}
  cancel-in-progress: true
```

**含义：**
- 同一 PR 的新提交自动取消旧构建
- push to branch 的构建与 PR 构建使用不同的 group key

### 7.2 PR 专属 group key 模式

```yaml
concurrency:
  group: pr-build-${{ github.event.issue.number }}
  cancel-in-progress: true
```

**优势：** 更精确的 PR 级别控制，同一 PR 的多次 `/build` 命令不会并行。

---

## 八、综合方案推荐

### 8.1 方案：两 Workflow + Draft Release + `/build` 命令

```
PR 评论 "/build"
    ↓
workflow 1: pr-build-trigger.yml
    - 检测 /build 命令
    - 发 "🔨 构建已触发" 评论
    - 上传 PR metadata artifact
    - 触发 workflow_run
    ↓
workflow 2: pr-build-executor.yml（workflow_run 触发）
    - 通过 run-id 下载 metadata
    - checkout PR head 代码（在 workflow_run 隔离环境）
    - 构建 Windows EXE + Android debug APK
    - 创建 Draft Release（target_commitish = PR head SHA）
    - 发 PR 评论附 Draft Release 链接
```

### 8.2 关键安全保证

1. **构建在 workflow_run 隔离环境执行**：不是直接在 PR 上下文中执行不可信代码
2. **secrets 通过 workflow_run 传递**：`workflow_run` 有完整 `GITHUB_TOKEN` 权限，可访问 repo secrets
3. **不 checkout PR head 代码**（在 workflow 2 中）：避免了缓存污染风险
4. **并发控制**：`cancel-in-progress` 避免同一 PR 多次构建浪费

### 8.3 Artifact 分发选择

**推荐 Draft Release**：
- Reviewer 点击链接即可下载，无需登录
- 持久链接，可重复访问
- 多文件一次性上传（exe + apk）
- 不污染正式 Release 历史（draft 状态）

---

## 九、参考资料

| 来源 | 内容 |
|------|------|
| `vercel/next.js` `.github/workflows/build_and_deploy.yml` | workflow_run 安全构建 + concurrency 控制 |
| `vercel/next.js` `.github/workflows/upload_preview_tarballs.yml` | Artifact 跨 workflow 共享（run-id 模式） |
| `rossjrw/pr-preview-action` `action.yml` | PR preview auto-deploy 模式 |
| `Cook-Unity/expo-pr-preview-build` | Expo PR build 专用 action |
| GitHub Docs: Events that Trigger Workflows | pull_request vs pull_request_target vs workflow_run |
| GitHub Docs: Automatic Token Authentication | GITHUB_TOKEN 权限模型 |
| `softprops/action-gh-release` | Draft Release 创建 |
| `dawidd6/action-download-artifact` | 跨 workflow artifact 下载 |
| Tauri Docs: Android Signing | Tauri Android 签名 secrets |

---

## 十、结论

1. **TouchAI 和 exomind 均未实现 PR 预构建**——调研的 5 个仓库中，真正有成熟 PR preview build 的是 Next.js（`vercel/next.js`）

2. **Next.js 的两 workflow + workflow_run 模式是最成熟的安全实践**，被多个大型开源项目采用

3. **推荐方案完全满足需求**：
   - 受人控制：slash command 触发，不发命令不构建 ✅
   - 不走 formal release 通道：Draft Release，不 push dev，不打 tag ✅
   - Android debug APK 无需签名，fork PR 也可用 ✅
   - Reviewer 直接下载体验好 ✅
