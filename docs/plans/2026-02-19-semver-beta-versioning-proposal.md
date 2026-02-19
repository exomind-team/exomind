# ExoMind 版本治理方案（SemVer + Beta + Hash）

## 1. 背景（Background / 背景）

当前仓库已经进入 `0.2.1` 的预发布节奏，但代码内与发布链路的版本语义存在不一致，影响：

1. 用户对版本认知不一致（代码显示 `0.2.0`，Release tag 显示 `0.2.1-preview*`）。
2. 产物命名无法快速定位构建来源（是否同一提交、同一预发布序号）。
3. 应用内缺少“版本 + 构建哈希（build hash）”的可视信息，不利于问题排查与回溯。

## 2. 现状（Current State / 现状）

### 2.1 代码内版本

- `package.json` 当前 `version = 0.2.0`
- `src-tauri/tauri.conf.json` 当前 `version = 0.2.0`
- `src-tauri/Cargo.toml` 当前 `version = 0.2.0`

### 2.2 发布标签与预发布

- 已使用标签：`release/v0.2.1-preview*-data-<sha7>`
- 当前 workflow 会把包含 `preview|alpha|beta|rc` 的版本判定为 `prerelease = true`
- Release 标题仍按 `Preview ...` 文案展示

### 2.3 产物命名

- Windows 产物中出现 `ExoMind_0.2.0_x64-setup.exe`（与 tag 语义不一致）
- Android 产物命名偏技术细节（如 `app-arm64-release-unsigned-signed.apk`），不够面向发布管理

## 3. 目标（Goals / 目标）

根据需求，目标统一为：

1. 将 `preview` 命名切换为 `beta`。
2. 统一代码版本到目标稳定版：`0.2.1`。
3. 预发布命名使用 `0.2.1-beta.1`（后续递增 `beta.2`、`beta.3`）。
4. 产物命名与应用内展示同时具备：
   - `version（版本号）`
   - `channel/pre-release（预发布渠道）`
   - `build hash（构建哈希）`

## 4. 方案（Proposed Solution / 解决方案）

### 4.1 版本源统一（Single Source of Truth / 单一事实源）

- 将三处版本统一改为：`0.2.1`
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`

说明：`0.2.1` 代表目标稳定版本；`beta.N` 通过标签与发布元信息表达，不直接写死在代码版本字段。

### 4.2 标签规则（Tag Convention / 标签规范）

继续沿用现有路径前缀，按已确认决策执行：

- 发布标签（构建 + GitHub Release）：`release/v0.2.1-beta.<n>`
- 不在标签中携带 `data` 或 `hash`

示例：

- `release/v0.2.1-beta.1`

说明：

- `hash（构建哈希）` 通过构建产物命名与应用内展示体现，不进入 tag。

### 4.3 Release 标题策略（Release Title / 发布标题）

- 当版本包含 `beta` 时，标题显示为：`Beta v0.2.1-beta.1`
- 正式版（无 pre-release 标识）显示：`Release v0.2.1`

### 4.4 产物命名策略（Artifact Naming / 产物命名）

引入统一命名模板：

- Windows EXE: `ExoMind-v<version>-<pre>-<hash>-x64-setup.exe`
- Windows MSI（若启用）: `ExoMind-v<version>-<pre>-<hash>-x64-installer.msi`
- Android APK（arm64）: `ExoMind-v<version>-<pre>-<hash>-android-arm64.apk`
- Android APK（x86）: `ExoMind-v<version>-<pre>-<hash>-android-x86.apk`

示例：

- `ExoMind-v0.2.1-beta.1-dbce231-x64-setup.exe`
- `ExoMind-v0.2.1-beta.1-dbce231-x64-installer.msi`
- `ExoMind-v0.2.1-beta.1-dbce231-android-arm64.apk`
- `ExoMind-v0.2.1-beta.1-dbce231-android-x86.apk`

说明：

- 该模板中的 `<pre>` 指 pre-release identifier（预发布标识），例如 `beta.1`。
- 该模板中的 `<hash>` 指 git short hash（提交短哈希），例如 `dbce231`。

### 4.5 应用内版本展示（In-App Version Display / 应用内展示）

在“设置（Settings）/ 关于（About）”区域新增或补充两项：

1. `App Version（应用版本）`：`0.2.1-beta.1`
2. `Build Hash（构建哈希）`：`dbce231`

建议数据来源：

- `version`：Tauri API `getVersion()`（桌面）+ `VITE_APP_VERSION`（Web/回退）
- `hash`：CI 注入 `VITE_BUILD_HASH`

### 4.6 业界常见做法（Common Practice / 常见规范）

为避免语义混乱，采用以下通用实践：

1. tag 使用可比较的 SemVer 版本语义：`vX.Y.Z-beta.N`，不混入提交哈希。
2. hash 放在产物名、应用内“关于页”、Release Notes（发布说明）中，用于可追溯。
3. GitHub `prerelease` 由版本字符串中的 `beta/alpha/rc` 与发布属性共同体现。

样例对照：

1. `release/v0.2.1-beta.1`（发布标签）
2. `Beta v0.2.1-beta.1`（发布标题）
3. `ExoMind-v0.2.1-beta.1-dbce231-android-arm64.apk`（发布产物）
4. `App Version: 0.2.1-beta.1` + `Build Hash: dbce231`（应用内展示）

## 5. 实施边界（Scope / 范围）

### 5.1 本 PR（方案评审 PR）包含

- 仅文档化现状与方案，不改业务代码，不改 CI 逻辑。

### 5.2 审批后实施 PR 包含

1. 版本字段统一到 `0.2.1`
2. release 标题文案由 `Preview` 改为 `Beta`
3. 产物重命名逻辑
4. 设置页版本/哈希展示
5. 真实 CI 验证（release tag）

## 6. 验收标准（Acceptance Criteria / 验收标准）

审批后实施时满足以下标准：

1. 三处代码版本一致为 `0.2.1`
2. 使用 `release/v0.2.1-beta.1` 触发后，Release 被标记为 `prerelease = true`
3. Release 标题为 `Beta ...`（不再使用 `Preview ...`）
4. Windows 与 Android 发布产物文件名包含 `version + beta序号 + hash`
5. 应用设置页可看到 `App Version` 与 `Build Hash`

## 7. 风险与回滚（Risk & Rollback / 风险与回滚）

### 7.1 风险

- 产物重命名若处理不当，可能导致 release 上传路径不匹配。
- 应用内版本展示若仅依赖 Tauri API，Web 模式可能缺字段。

### 7.2 回滚

- 任何一步失败可回滚到“保持现有产物命名，仅先统一版本与 beta 标题”
- 保证主干构建不被阻断

## 8. 已确认决策（Approved Decisions / 已确认）

以下决策已由评审确认：

1. 发布标签采用：`release/v0.2.1-beta.1`（不带 `data`、不带 `hash`）。
2. 应用显示采用：`App Version = 0.2.1-beta.1`，`Build Hash = dbce231`。
3. 产物文件名采用统一模板并包含 hash：`ExoMind-v<version>-<pre>-<hash>-<platform>`。
