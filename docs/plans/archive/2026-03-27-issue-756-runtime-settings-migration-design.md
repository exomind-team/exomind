# Issue #756 Runtime Settings Migration Design

**Date:** 2026-03-27  
**Status:** Draft  
**Scope:** 把仍滞留在前端 `localStorage / IndexedDB` 的关键设置、快捷键、密钥迁到 Runtime SQLite，打通 `tauri dev` 与安装版的数据连续性

---

## 1. 背景 / Background（背景）

当前 ExoMind 的核心业务数据已经基本进入 Runtime SQLite：

1. `eventlog.sqlite`
2. `tasks.sqlite`
3. `timeblocks.sqlite`
4. `sessions.sqlite`

这意味着：

1. 事件日志、任务、时间块、Agent session 元数据本身，已经不再主要卡在前端 origin（来源域）里。
2. 用户从 `dev` 切到安装版时，真正导致“连续性断裂”的，主要不是核心业务数据，而是**设置真相源（settings source of truth，设置真相源）仍在前端**。

当前前端仍直接持久化大量关键配置：

1. `src/config/config-factory.ts`
2. `src/ui/app/config/settings/settings-registry.ts`
3. `src/lib/ai-registry/storage.ts`
4. `src/lib/ai-registry/secrets.ts`

已经确认本机同时存在两个 WebView origin（来源域）数据空间：

1. `http://localhost:1420`（当前 `tauri dev`）
2. `tauri.localhost / tauri://localhost`（安装版）

这两个 origin 的 `localStorage / IndexedDB` 是隔离的，因此：

1. 安装版不能天然读到 `dev` 的前端设置。
2. `dev` 也不能天然复用安装版的前端设置。
3. 只要设置继续以前端存储为真相源，用户就会持续遇到“核心数据在，偏好和密钥没了”的问题。

---

## 2. 目标 / Goals（目标）

`#756` 的目标不是“把所有浏览器缓存全搬走”，而是先解决用户真正会痛的连续性问题：

1. 把**关键用户设置（critical user settings，关键用户设置）**迁到 Runtime SQLite。
2. 把**敏感凭据（secrets，密钥/令牌）**迁到 Runtime SQLite。
3. 让 `tauri dev` 与安装版共享同一份 Runtime 设置数据。
4. 保持现有前端大量同步 `get / set / subscribe` 调用方式基本不崩。
5. 保持 Web-first（先保证 Web 端不坏），Runtime 不可用时仍可回退到浏览器本地存储。
6. 提供一次性 migration（迁移）路径，把旧前端存储导入 Runtime。

---

## 3. 非目标 / Non-goals（本次不做）

本轮明确不做以下事情，避免 `#756` 失控：

1. 不一次性迁走全部 `localStorage` key。
2. 不迁 `sessionStorage`、页面草稿、路由记忆、临时 UI 状态。
3. 不做 Windows/WebView2 磁盘级跨 origin 扫描和解析。
4. 不在本轮解决 PTY 进程级恢复、Codex 进程续跑问题。
5. 不重做设置页 UI 结构。
6. 不在本轮引入操作系统级密钥链（OS keychain，系统密钥链）。

说明：

1. Agent session 元数据已经进入 `sessions.sqlite`，这和“设置连续性”是两条线。
2. PTY/Codex 进程在关闭桌面应用后的恢复控制，应继续走 Agent/PTY 专题，不应塞进 `#756`。

---

## 4. 为什么不能继续用前端存储 / Why Frontend Storage Must Stop Being Source of Truth

### 4.1 前端 origin 天然分叉

`localStorage / IndexedDB` 是按 origin 隔离的。  
因此 `http://localhost:1420` 与安装版 WebView 不是同一个设置空间。

### 4.2 当前关键配置仍直接写前端

已确认以下内容仍直接写前端：

1. 主题、快捷键、输入偏好、Overlay 偏好
2. `moss_api_key`
3. 火山 `AppKey / AccessKey / Resource ID / endpoint / language`
4. `AI Registry snapshot`
5. `AI Registry energy secrets`

### 4.3 快捷键当前是“前端配置 + Runtime apply”

当前全局快捷键链路并不是 Runtime 持久化：

1. 前端从 `localStorage` 读快捷键
2. 设置页或服务启动时再调用 Runtime command 去 apply（应用）
3. 切换壳层后，前端配置丢了，Runtime 也无法自动恢复用户原值

### 4.4 继续 patch localStorage 没有终局价值

如果只是继续补 localStorage 逻辑：

1. `dev` / 安装版 依然两套数据
2. 多窗口 / 多 origin 一致性依然脆弱
3. 密钥仍然散落在浏览器存储层

结论：**前端存储可以继续做缓存层（cache，缓存），但不能再做真相源。**

---

## 5. 设置分类 / Settings Classification（设置分类）

本轮采用“先分类，再迁移”的策略。

### 5.1 Batch A：优先迁移的关键用户设置

这批直接影响“安装版接上就能用”：

1. `exomind:themePreference`
2. `exomind:voiceShortcutHotkey`
3. `exomind:mainWindowShortcutSelection`
4. `exomind:mainWindowShortcutSelectionCustomized`
5. `exomind:mainWindowShortcutQuickFocusEnabled`
6. `exomind:voiceShortcutAsrProvider`
7. `exomind:voiceShortcutSendMode`
8. `exomind:voiceShortcutMicPrewarmEnabled`
9. `exomind:voiceTranscriptSendMode`
10. `exomind:inputSendMode`
11. `moss_api_key`
12. 火山 ASR 相关 key 与识别参数
13. `exomind:ai-registry:snapshot`
14. `exomind:ai-registry:energy-secret:*`

### 5.2 Batch B：高频偏好，但不阻塞连续性

这批适合在 Runtime 配置基础设施稳定后继续收口：

1. `feedbackPreferences`
2. `timerPreferences`
3. `focusBgmPreferences`
4. `voiceOverlay*`
5. `nowWorkbenchOverlay*`
6. `task-dag-*`
7. `tasks-default-tab`
8. `task-page-fuzzy-search`
9. `task-create-success-action`
10. 页面开关与部分 feature toggles（功能开关）

### 5.3 Batch C：暂时保留前端或单独处理

这批更像设备/调试/联调状态，不应和用户设置混在第一批：

1. `exomind:syncServerUrl`
2. `exomind:runtimeTargetMode`
3. `exomind:runtimeExternalAddress`
4. `exomind:embeddedRuntimeNetworkMode`
5. `exomind:embeddedRuntimeStatus`
6. `exomind:developerMode`
7. `exomind:devtoolsEnabled`
8. `exomind:useMockData`
9. `eventlog/task/timeblock backend mode`
10. 各类 `sessionStorage` 路由记忆、草稿、临时 UI 状态

---

## 6. 选定方案 / Chosen Architecture（选定架构）

### 6.1 核心决策：新增 `RuntimeConfigStore (SQLite)`

在 Runtime 内新增一个通用配置存储模块，结构风格对齐现有：

1. `task::TaskStore`
2. `timeblock::TimeBlockStore`
3. `session::SessionStore`

建议新增：

1. `crates/exomind-runtime/src/config/store.rs`
2. `crates/exomind-runtime/src/config/sqlite_store.rs`
3. `crates/exomind-runtime/src/config/types.rs`
4. `crates/exomind-runtime/src/routes/config.rs`

### 6.2 不重造值结构，先存“原始字符串（raw string，原始串）”

本轮**不把所有设置都翻译成 Rust 强类型结构体**。  
Runtime 配置表优先存储“前端原本写进 localStorage 的 canonical raw value（规范化后的原始值）”。

这样做的原因：

1. 现有前端每个设置模块已经有自己的 normalize（归一化）逻辑。
2. 像 `timerPreferences`、`feedbackPreferences` 本来就是 JSON 字符串。
3. 像 `themePreference`、`voiceShortcutHotkey` 本来就是简单字符串。
4. 这样可以最大限度减少前端模块改造量。
5. 不需要在 Rust 再复制一套完整设置 schema（模式）。

换句话说，第一阶段的 RuntimeConfigStore 更像：

1. `selected localStorage mirror（受控的 localStorage 镜像）`
2. 但真相源在 Runtime SQLite，而不在浏览器 origin

### 6.3 表结构建议

建议使用单表：

`runtime_config_entries`

字段：

1. `scope TEXT NOT NULL`  
   值：`user` | `device`
2. `key TEXT NOT NULL`
3. `value TEXT NOT NULL`
4. `sensitive INTEGER NOT NULL DEFAULT 0`
5. `updated_at TEXT NOT NULL`
6. `source TEXT`
7. `source_origin TEXT`

主键：

1. `(scope, key)`

当前 `#756` 只落 `scope = user` 的 Batch A。  
`device` 列先保留，为后续 Batch C 或诊断配置做准备。

### 6.4 Runtime HTTP API

建议新增以下最小路由：

1. `GET /config?scope=user&prefix=exomind:`
2. `PUT /config/{key}`
3. `DELETE /config/{key}`
4. `POST /config/import/frontend`
5. `POST /config/reset`
6. `GET /config/stream`

说明：

1. `GET /config` 用于前端 bootstrap snapshot（启动快照）拉取。
2. `PUT / DELETE` 用于日常设置读写。
3. `POST /config/import/frontend` 用于一次性导入旧前端设置。
4. `POST /config/reset` 用于“重置全部设置”。
5. `GET /config/stream` 用于跨窗口/跨客户端订阅配置变化。

### 6.5 Runtime 启动默认路径

Tauri 启动时应新增：

1. `EXOMIND_RT_CONFIG_SQLITE_PATH`

默认落在现有 Runtime 数据目录中：

1. `config.sqlite`

对应位置与现有：

1. `eventlog.sqlite`
2. `tasks.sqlite`
3. `timeblocks.sqlite`
4. `sessions.sqlite`

保持一致。

---

## 7. 前端过渡层 / Frontend Transition Layer（前端过渡层）

### 7.1 不能把现有配置模块直接改成纯异步

当前很多地方默认配置 API 是同步的：

1. `ThemeController`
2. `App.tsx` 里的服务初始化
3. `SettingsPage`
4. 各种 `getXxx() / subscribeXxxChanges()`

如果直接把这些配置模块改成“每次都 fetch Runtime”，会造成：

1. 首屏闪烁
2. 服务初始化顺序混乱
3. 大量 UI/测试改造

### 7.2 选定方案：`RuntimeConfigCache + Bootstrap`

前端新增一个运行时配置桥接层：

1. 启动时先从 Runtime 拉取 Batch A 快照
2. 把这些 key 放进内存 Map（内存缓存）
3. 现有 `get / set / subscribe` 仍然同步读取这个内存缓存
4. 设置变更时，先更新内存缓存并发本地事件，再异步写 Runtime

建议新增：

1. `src/config/runtime-config-cache.ts`
2. `src/config/runtime-config-adapter.ts`

### 7.3 启动顺序

建议在 `src/main.tsx` 里把顺序改为：

1. `ensureCryptoRandomUUID()`
2. `await bootstrapRuntimeConfig()`
3. `syncDevtoolsWithSettings()`
4. `render(<App />)`

这样可以保证：

1. 主题首帧读取的是 Runtime 值
2. 快捷键服务初始化时拿到的是 Runtime 值
3. 设置页首开不会先显示默认值再跳变

### 7.4 前端模块改造策略

不建议一次性重写全部 `src/config/*`。  
更稳的做法是：

1. 保留现有模块导出接口不变
2. 先让 Batch A 这些模块从 `RuntimeConfigCache` 读写
3. 非 Batch A 模块继续走原 `localStorage`

这样 `#756` 是**受控收口（controlled convergence，受控收口）**，而不是大爆炸迁移。

---

## 8. Migration 设计 / Migration Design（迁移设计）

### 8.1 关键现实：浏览器不能跨 origin 读旧设置

安装版第一次启动时，无法直接从 `http://localhost:1420` 读取旧 dev 的 `localStorage`。  
这不是实现细节，而是浏览器安全边界。

所以本轮**不做**以下脆弱方案：

1. 直接扫描 WebView2 磁盘文件
2. 解析不同 origin 的浏览器内部数据库

### 8.2 选定迁移策略：`same-origin export -> Runtime import`

哪一个 origin 被升级了，它就负责把**自己当前 origin 下的旧设置**导入 Runtime。

流程：

1. 升级后的 `dev` 启动
2. 读取自己当前 origin 下的旧前端设置
3. 通过 `POST /config/import/frontend` 导入 Runtime SQLite
4. 导入成功后，Runtime 成为真相源
5. 之后安装版启动时直接读 Runtime，就能接上

安装版旧用户同理：

1. 升级后的安装版启动
2. 读取安装版自己旧 origin 下的前端设置
3. 导入 Runtime

### 8.3 自动迁移规则

自动迁移必须满足两个要求：

1. **幂等（idempotent，重复执行结果稳定）**
2. **不互相覆盖**

建议规则：

1. Runtime 里若不存在 `settings-migration-v1` 标记，则允许自动导入
2. 自动导入采用 `if-empty（仅填充空目标）`
3. 一旦 Runtime 已有目标 key，不再自动覆盖
4. 在 Runtime 里记录：
   - `migration_version`
   - `source_origin`
   - `completed_at`

这意味着：

1. **第一个升级并完成导入的 origin，成为自动迁移的基准来源**
2. 后续 origin 不会默默把已有 Runtime 配置冲掉

### 8.4 手动重导入

由于自动迁移采取“first writer wins（首个写入者生效）”，建议在设置页开发者/数据区补一个手动动作：

1. `Import current app settings into Runtime（把当前壳层的旧设置重新导入 Runtime）`

这个动作允许：

1. 用户明确以当前壳层为准
2. `mode = overwrite`
3. 解决双 origin 都有旧配置、但用户想指定以哪边为准的问题

### 8.5 AI Registry 迁移

AI Registry 目前不只是一个 key，而是：

1. `snapshot`
2. `energy-secret:*`

建议第一阶段仍按现有 key 体系迁移，不重建新的 AI provider store：

1. `exomind:ai-registry:snapshot`
2. `exomind:ai-registry:energy-secret:*`

原因：

1. 用户当前最关心的是“密钥别丢、模型别重配”
2. 不是“立刻把 AI Registry 变成新领域模型”

---

## 9. 快捷键与设置副作用 / Side Effects（副作用处理）

不是所有设置都只是“存个值”。

### 9.1 需要 Runtime apply 的设置

以下配置修改后，除了持久化，还要立即 apply 到系统/运行时：

1. `voiceShortcutHotkey`
2. `mainWindowShortcutSelection`

建议新链路：

1. 前端更新 `RuntimeConfigCache`
2. 持久化写入 `RuntimeConfigStore`
3. 成功后调用对应 Tauri command 做快捷键 apply
4. 失败时回滚内存值，并给设置页错误提示

### 9.2 只影响 UI 的设置

例如：

1. `themePreference`
2. `inputSendMode`
3. `voiceOverlay*`

这类可以：

1. 先更新内存值与 UI
2. 异步写 Runtime
3. 写失败时提示，但不必阻断当前 UI 更新

---

## 10. 清理与重置语义 / Reset Semantics（清理与重置语义）

当前设置页里有两个危险动作：

1. `清空本地缓存`
2. `重置所有设置`

迁移到 Runtime 后，这两个动作必须重新定义。

### 10.1 清空本地缓存

新的语义应为：

1. 只清理浏览器本地缓存、`sessionStorage`、临时 UI 状态
2. 不删除 Runtime-backed（Runtime 托管）的关键设置

### 10.2 重置所有设置

新的语义应为：

1. 删除 Runtime 里的 Batch A / Batch B 用户设置
2. 同时清理残留 localStorage 的本地 UI 键
3. 重新回到默认值

否则用户会看到：

1. 表面点了“重置”
2. 实际一重启又从 Runtime 恢复回来

这会非常迷惑。

---

## 11. 推荐拆分 / Recommended Delivery Split（推荐拆分）

不建议把 `#756` 一次性做成一个超大 PR。  
建议在同一个 issue 下拆成 3 个连续批次：

### PR 1：Runtime Config 基础设施 + Batch A 核心设置

范围：

1. `RuntimeConfigStore`
2. `/config` 路由
3. `config.sqlite` 默认路径
4. 前端 `RuntimeConfigCache`
5. 主题、快捷键、语音 provider、MOSS、火山 key
6. 自动 migration v1

这是最有用户价值的一步，优先落地。

### PR 2：AI Registry 与 Secrets 收口

范围：

1. `ai-registry snapshot`
2. `ai-registry energy-secret:*`
3. LLM 默认草稿兼容迁移
4. 手动重导入动作

这是“密钥别丢、模型别重配”的关键补全。

### PR 3：高频偏好 + reset/cleanup 完整语义

范围：

1. `timer / feedback / focus bgm / overlay / DAG / default tab`
2. `clear local cache / reset all settings`
3. 开发者诊断与 backend status

---

## 12. 验收标准 / Acceptance Criteria（验收标准）

`#756` 至少需要满足以下验收：

1. 在 `tauri dev` 中修改 Batch A 设置后，关闭应用再开，设置仍在。
2. 在升级后的 `tauri dev` 中完成一次导入后，安装版启动能直接读到相同 Batch A 设置。
3. 安装版修改 Batch A 设置后，重新打开 `dev`，设置保持一致。
4. `MOSS / 火山 / AI Registry` 不需要重复手填。
5. `ThemeController`、语音快捷键、主窗口快捷键在首帧/首启时读取的是 Runtime 值，而不是默认值。
6. `清空本地缓存` 不会误删 Runtime 托管设置。
7. `重置所有设置` 会真正把 Runtime 托管设置也清掉。

---

## 13. 测试建议 / Test Strategy（测试建议）

### 13.1 Rust

1. `ConfigStore` SQLite reopen persistence（重开持久化）
2. `/config` routes
3. `/config/import/frontend` 幂等性
4. `first writer wins` 自动迁移规则
5. `/config/reset`

### 13.2 Frontend

1. `bootstrapRuntimeConfig()` 在 render 前注入快照
2. Batch A 配置模块改走 RuntimeCache 后，`get / set / subscribe` 语义不变
3. `settings-registry` 中的 MOSS/火山/主题/快捷键行为保持正确
4. `AI Registry` 改走 Runtime 后，默认草稿和现有兼容逻辑仍成立

### 13.3 Manual（手测）

1. `dev -> 安装版`
2. `安装版 -> dev`
3. 手动“重新导入当前壳层旧设置”
4. `reset all settings`

---

## 14. 最终建议 / Recommendation（建议结论）

围绕 `#756`，我建议采用下面这条主线：

1. **先新增 RuntimeConfigStore，而不是继续补 localStorage。**
2. **第一阶段直接复用现有 localStorage key 名，不做大规模 key 重命名。**
3. **前端通过 bootstrap + 内存缓存维持同步配置 API，避免全项目异步化。**
4. **迁移采用 same-origin export -> Runtime import，不做磁盘级跨 origin 读取。**
5. **先做 Batch A，先解决主题、快捷键、密钥、AI Registry。**

这条路径的优点是：

1. 真正解决 `dev / 安装版` 连续性
2. 改造量受控
3. 与现有 Runtime SQLite 架构一致
4. 能在不破坏当前 Web-first 开发链路的前提下落地

