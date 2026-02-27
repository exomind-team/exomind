# 构建产物 R2 存储 + 全链路自动更新系统设计

> Issue: #262
> 日期: 2026-02-27
> 状态: 设计审核中

## 1. 概述

建立从 CI 构建 → Cloudflare R2 对象存储 → Worker API → 官网下载页 → 客户端自动更新的全链路统一方案。

### 目标

- 构建产物上传到 Cloudflare R2，不再仅依赖 GitHub Releases
- 双通道（release / preview）分发
- 官网下载页支持通道切换
- 客户端（桌面 + 手机）自动检测更新，非侵入式提示
- 资源有限原则：R2 免费 10GB，preview 滚动保留可配置数量

## 2. 架构总览

```
GitHub Actions (CI)
├── build-android → ARM APK
├── build-windows → x64 exe
└── upload-r2 (新增步骤)
     ├── 上传产物到 R2 bucket
     ├── 更新 {channel}/latest.json
     └── preview 超限时删除最旧版本

Cloudflare R2 (对象存储)
└── exomind-releases/
     ├── release/{version}/*.exe, *.apk
     ├── release/latest.json
     ├── preview/{version}/*.exe, *.apk
     ├── preview/latest.json
     ├── preview/versions.json
     └── config.json

Cloudflare Worker (API, 复用 Astro SSR)
└── /api/update/check, /api/download, /api/versions

官网 (exo-mind.ai)
└── /download → 双通道切换下载页

客户端 (Tauri App)
├── 桌面端 → 定时检查 → Toast 提示 → 下载/安装
└── 手机端 → 定时检查 → Toast 提示 → 下载/安装
```

## 3. R2 存储结构

方案：按通道分目录（方案 A）。

```
exomind-releases/
├── release/
│   ├── v0.3.3/
│   │   ├── ExoMind-0.3.3-windows-x64-setup.exe
│   │   └── ExoMind-0.3.3-android-arm64.apk
│   └── latest.json
├── preview/
│   ├── v0.3.4-build.20260227T1430/
│   │   ├── ExoMind-0.3.4-windows-x64-setup.exe
│   │   └── ExoMind-0.3.4-android-arm64.apk
│   ├── latest.json
│   └── versions.json
└── config.json
```

### 3.1 latest.json（双通道共用格式）

```json
{
  "version": "0.3.3",
  "channel": "release",
  "date": "2026-02-27T14:30:00Z",
  "assets": {
    "windows-x64": {
      "url": "/release/v0.3.3/ExoMind-0.3.3-windows-x64-setup.exe",
      "size": 52428800,
      "sha256": "abc123..."
    },
    "android-arm64": {
      "url": "/release/v0.3.3/ExoMind-0.3.3-android-arm64.apk",
      "size": 31457280,
      "sha256": "def456..."
    }
  },
  "notes": "修复了xxx，新增了yyy"
}
```

### 3.2 versions.json（preview 通道专用）

```json
{
  "channel": "preview",
  "max_keep": 15,
  "versions": [
    {
      "version": "0.3.4-build.20260227T1430",
      "date": "2026-02-27T14:30:00Z",
      "assets": {
        "windows-x64": {
          "url": "/preview/v0.3.4-build.20260227T1430/ExoMind-0.3.4-windows-x64-setup.exe",
          "size": 52428800,
          "sha256": "abc123..."
        },
        "android-arm64": {
          "url": "/preview/v0.3.4-build.20260227T1430/ExoMind-0.3.4-android-arm64.apk",
          "size": 31457280,
          "sha256": "def456..."
        }
      },
      "notes": ""
    }
  ]
}
```

### 3.3 config.json（可配置项）

```json
{
  "preview_max_keep": 15
}
```

CI 上传时读取此文件获取保留数量。可随时修改，无需改代码。

## 4. Worker API 设计

复用现有 Astro SSR（Cloudflare Workers 适配器），API 路由放在 `website/src/pages/api/`。

### 4.1 更新检查

```
GET /api/update/check?channel=release&platform=windows-x64&current_version=0.3.3
```

响应（有更新）：

```json
{
  "has_update": true,
  "latest": {
    "version": "0.3.4",
    "date": "2026-02-27T14:30:00Z",
    "url": "https://exo-mind.ai/api/download/release/v0.3.4/windows-x64",
    "size": 52428800,
    "sha256": "abc123...",
    "notes": "修复了xxx，新增了yyy"
  }
}
```

响应（无更新）：

```json
{
  "has_update": false
}
```

版本比较逻辑：semver 比较，`current_version < latest.version` 则有更新。

### 4.2 下载代理

```
GET /api/download/:channel/:version/:platform
```

Worker 从 R2 读取文件流式返回。下载链接统一走官网域名，不暴露 R2 地址。

### 4.3 版本列表

```
GET /api/versions?channel=preview
```

返回 `versions.json` 内容，供官网下载页渲染 preview 列表。

```
GET /api/versions?channel=release
```

返回 `latest.json` 内容（release 只展示最新一个）。

### 4.4 wrangler.toml R2 绑定

```toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "exomind-releases"
```

## 5. CI 上传流程

在现有 `release.yml` 的 `create-release` job 中，GitHub Release 步骤之后新增 R2 上传步骤。

### 5.1 流程

```
1. 安装 wrangler CLI
2. 判断通道：release/* tag → release，build/* tag → preview
3. 上传产物到 R2: {channel}/{version}/*.exe, *.apk
4. 计算 sha256，生成该版本的 asset 信息
5. 更新 {channel}/latest.json
6. 如果是 preview 通道：
   a. 读取 config.json 获取 preview_max_keep
   b. 读取 versions.json，追加新版本到头部
   c. 如果超过 max_keep，删除最旧版本的 R2 目录
   d. 写回 versions.json
7. 如果是 release 通道：
   a. 覆盖 release/latest.json
```

### 5.2 新增 GitHub Secrets

| Secret | 用途 |
|--------|------|
| `CF_ACCOUNT_ID` | Cloudflare 账户 ID |
| `CF_API_TOKEN` | Cloudflare API Token（R2 读写权限） |

### 5.3 preview 清理逻辑（伪代码）

```bash
# 读取配置
MAX_KEEP=$(wrangler r2 object get exomind-releases/config.json | jq -r '.preview_max_keep')

# 读取当前版本列表
VERSIONS=$(wrangler r2 object get exomind-releases/preview/versions.json)

# 计算需要删除的版本
TO_DELETE=$(echo $VERSIONS | jq ".versions[$MAX_KEEP:]")

# 删除旧版本的 R2 对象
for version in $TO_DELETE; do
  wrangler r2 object delete "exomind-releases/preview/$version/*"
done

# 更新 versions.json（只保留前 MAX_KEEP 个）
echo $VERSIONS | jq ".versions = .versions[:$MAX_KEEP]" | wrangler r2 object put exomind-releases/preview/versions.json
```

## 6. 官网下载页改造

现有 `website/src/pages/download.astro` 改为单页双通道。

### 6.1 页面结构

```
┌──────────────────────────────────────┐
│  下载 ExoMind                        │
│                                      │
│  [Release ●] [Preview]   ← 通道切换  │
│                                      │
│  ── Release 通道 ──                  │
│  v0.3.3 (2026-02-27)                │
│  [Windows 下载]  [Android 下载]      │
│  更新说明...                         │
│                                      │
│  ── 切换到 Preview 后 ──            │
│  v0.3.4-build.20260227  最新         │
│  [Windows]  [Android]                │
│  ─────────────────────               │
│  v0.3.4-build.20260226              │
│  [Windows]  [Android]                │
│  ...最多 15 个                       │
└──────────────────────────────────────┘
```

### 6.2 数据获取

- 页面加载：调 `/api/versions?channel=release` 渲染默认 release 通道
- 切换通道：前端 JS 调 `/api/versions?channel=preview` 动态渲染列表
- 下载链接：指向 `/api/download/:channel/:version/:platform`

## 7. 客户端更新模块

### 7.1 更新行为矩阵

| 平台 | 通道 | 检查 | 提示 | 下载 | 安装 |
|------|------|------|------|------|------|
| 桌面 Windows | release | 定时自动 | Toast + 小红点 | 用户手动 | 用户手动 |
| 桌面 Windows | preview | 定时自动 | Toast + 小红点 | 自动下载 | 提示完成，用户手动点安装 |
| 手机 Android | release | 定时自动 | Toast + 小红点 | 用户手动 | 用户手动 |
| 手机 Android | preview | 定时自动 | Toast + 小红点 | 自动下载 | 提示完成，用户手动点安装 |

### 7.2 更新设置项

| 设置项 | 选项 | 默认值 |
|--------|------|--------|
| 更新通道 | release / preview | release |
| 检查间隔 | 每小时 / 每6小时 / 每天 / 手动 | 每天 |
| preview 自动下载 | 开 / 关 | 开 |

### 7.3 文件结构

```
src/
├── services/
│   └── update-service.ts       ← 核心更新逻辑
├── stores/
│   └── update-store.ts         ← 更新状态管理
├── ui/new/components/
│   └── UpdateToast.tsx          ← Toast 通知组件
└── ui/new/pages/
    └── UpdatePage.tsx           ← 已有，改造为更新设置 + 安装页
```

### 7.4 update-service.ts 职责

- 启动时 + 定时调 `/api/update/check` 检查更新
- 根据通道 + 平台决定行为（自动下载 or 仅提示）
- preview 通道自动下载：调 Tauri HTTP API 下载到本地临时目录
- 下载完成后通知 store，触发 Toast "下载完成，点击安装"
- 桌面端安装：调 `shell.open()` 打开 exe 安装包
- Android 端安装：调 Android Intent 打开 APK

### 7.5 Toast 通知行为

- 检测到新版本 → 底部滑入 Toast "ExoMind v0.3.4 可用"
- 3~5 秒后自动消失
- 设置页出现小红点标记
- 不打断用户当前操作

## 8. 实施计划

### Phase 1: R2 基础设施

1. 创建 Cloudflare R2 bucket `exomind-releases`
2. 上传初始 `config.json`
3. 配置 GitHub Secrets（`CF_ACCOUNT_ID`, `CF_API_TOKEN`）

### Phase 2: CI 上传流程

4. 修改 `.github/workflows/release.yml`，新增 R2 上传步骤
5. 实现 preview 清理逻辑
6. 测试 build/* tag 触发上传

### Phase 3: Worker API

7. `website/src/pages/api/update/check.ts` — 更新检查 API
8. `website/src/pages/api/download/[...path].ts` — 下载代理 API
9. `website/src/pages/api/versions.ts` — 版本列表 API
10. `wrangler.toml` 添加 R2 绑定

### Phase 4: 官网下载页

11. 改造 `download.astro` 为双通道切换页面
12. 前端 JS 对接 API

### Phase 5: 客户端更新模块

13. `update-service.ts` — 更新检查 + 下载逻辑
14. `update-store.ts` — 状态管理
15. `UpdateToast.tsx` — Toast 通知组件
16. 改造 `UpdatePage.tsx` — 更新设置页
17. 集成到应用启动流程

### Phase 6: 测试验证

18. 端到端测试：tag → CI → R2 → API → 官网 → 客户端
19. preview 滚动清理验证
20. 各平台更新流程验证
