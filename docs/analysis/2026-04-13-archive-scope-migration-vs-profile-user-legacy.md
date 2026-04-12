# 2026-04-13 Archive OS / multi-archive 语义与 profile/user_id 作用域原语之间的迁移断层

## 问题定义

4 月 6 日到 4 月 7 日的计划文档，已经把 ExoMind 的核心对象从 `profile` 收口到 `archive`，并且把 `archive_id`、`ArchiveSession`、`UiSession`、默认档案、档案切换器、多档案并活、集体档案同型等语义讲清楚了；文档甚至明确写了第一阶段要把 `activeProfileId / unlockedProfileIds` 迁成 `activeArchiveId / unlockedArchiveIds`，并采用“旧 `profile` 键双读，新 `archive` 键单写”的迁移策略（`docs/plans/2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md:15-30`，`docs/plans/2026-04-06-multi-archive-and-collective-settled-decisions.md:28-55`）。

现实代码没有跟上这层语义迁移。当前实现真正驱动本地会话、RT HTTP query、复制信号、SQLite/PouchDB 分库、CLI 兼容和 UI 账户入口的，仍然是四套旧原语：

- `profileId / activeProfileId / unlockedProfileIds`
- `user_id`
- `scopeKey`
- `currentUser / anonymous` 兼容回退

这不是“文档先改、代码后面慢慢 rename”那么简单。当前代码里的旧原语不是单纯文案，它们已经是数据主键、存储命名空间、协议字段、回退桥和默认匿名作用域。真正的断层在于：文档现在讨论的是“档案 OS”和“多档案会话系统”，而代码仍然在跑“单活 profile + user_id scope + 通用 scopeKey”这套前一阶段模型。

## 文档中已澄清的新命名与会话边界

### 1. 核心对象已经正式改名为 `archive`

`docs/plans/2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md:15-30` 已经给出明确决策：

- 正式术语统一为 `archive`
- `profile` 退回展示层、资料卡、对外描述等轻表面
- 存储迁移是“旧 `profile` 键双读，新 `archive` 键单写”
- 会话字段迁移目标已经明确写成 `activeArchiveId / unlockedArchiveIds`

这说明文档层不是在讨论“profile 的另一个别名”，而是在做一轮边界重命名，且已经指定持久字段迁移目标。

### 2. 新语义不只是对象改名，还重定义了会话边界

`docs/plans/2026-04-07-archive-session-and-ui-session-clarifications.md:11-19`、`22-55`、`58-87`、`90-99` 把边界收口为：

- `ArchiveSession` 是某个 `RT` 上某个档案的本地运行会话
- `UiSession / ClientSession` 是外部 UI 终端连接
- `前台 / 后台` 是 UI 派生概念，不是 RT 状态机字段
- 第一阶段 RT 侧最小状态只剩 `running / closed`，UI 连接只跟踪 `connected / disconnected`

这直接否定了“当前激活 profile = 当前运行会话”的旧理解。文档要的是“一个 RT 里可有多个 running archive，UI 只是连接其中一个”。

### 3. 多档案与集体档案已被定义为同一身份层

`docs/plans/2026-04-06-multi-archive-and-collective-settled-decisions.md:30-55`、`102-107`、`214-245` 已经定稿：

- 档案稳定主键是不可变 `archive_id`
- 个人档案与集体档案在身份层同型
- 集体档案也有自己的 `ArchiveSession`
- 公开标识和关系沉淀最终都映射回 `archive_id`

这意味着 `archive` 不是“本地 profile 的新中文名”，而是未来个人档案、集体档案、公开身份、关系对象的共同基座。

### 4. 默认档案与切换器的语义已经落在 OS 层

`docs/plans/2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md:33-45`、`50-76`、`79-108`、`134-153` 明确要求：

- 一个 Tauri App 内，RT 持有多个 `ArchiveSession`
- 默认启动入口是固定存在的本地默认档案
- 同一档案在同一 RT 第一阶段只允许一个 `UiSession`
- 档案切换器要显示当前/运行中/已占用/已锁定
- 默认档案可升级为正式个人档案，升级后 RT 自动补出新的空白默认档案

这套模型要求 RT 具备“档案元信息 + 会话占用 + 默认档案生命周期”三个维度，而不仅是“当前 active profile 是谁”。

## 现实代码仍依赖的旧作用域原语

### 1. 本地主键和会话状态仍然是 `profileId`

`src/lib/profile/types.ts:7-17`、`19-23`、`53-57` 仍把本地核心实体定义成 `LocalProfile`、`ProfileSecret`、`ProfileSessionState`，主键和值对象字段都是 `profileId / activeProfileId / unlockedProfileIds`。

`src/lib/profile/profile-storage.ts:8-20`、`85-88`、`98-108`、`156-169`、`194-230` 进一步把这个命名落成了真实存储结构：

- 本地仓储键名是 `exomind:profiles:*`、`exomind:profile-session`
- 本地主键格式是 `profile-${slug}`
- 当前会话持久化字段是 `activeProfileId / unlockedProfileIds`
- 新建本地档案时产出的实体字段仍是 `profileId`

`src/lib/profile/profile-storage.ts:245-315` 还保留了从旧 `exomind:users` / `exomind:sync-store` 迁入 profile 体系的桥接逻辑，`getCurrentProfileOrLegacyId()` 会按 “active profile -> legacy currentUser -> anonymous” 顺序回退。这说明 profile 不是表层名词，而是当前所有本地身份迁移的承接层。

### 2. 远端身份绑定和同步凭据也仍然绑定到 `profileId`

`src/lib/profile/identity-link-storage.ts:53-59`、`61-67`、`69-129` 里，IdentityLink 的过滤、首选、创建都以 `profileId` 为归属键。

`src/environment/interfaces/sync.port.ts:101-114` 仍把同步凭据字段定义为 `localProfileId`；`src/ui/stores/sync-store.ts:107-128`、`140-165`、`185-215`、`291-302`、`337-356`、`372-391` 则把 `activeProfileId`、`currentUser`、`localProfileId`、IdentityLink 绑定、登录/登出流程全部揉在同一个 store 里。

结果是：当前“作用域”不是单独的 archive scope，它已经和本地解锁、远端身份绑定、同步状态恢复绑死在一起。

### 3. RT HTTP 边界仍默认把当前作用域写成 `user_id`

`src/lib/adapters/runtime-profile-scope.ts:1-10` 的注释已经把事实写得很直白：它用 `getCurrentProfileOrLegacyId()` 取得当前档案键，并统一透传为 `user_id` query。

这个 helper 不是 proposal 独享，而是 RT 适配层的公共边界：

- `src/lib/adapters/proposal-rt-adapter.ts:17`、`309-310`
- `src/lib/adapters/task-rt-adapter.ts:9`、`275-276`
- `src/lib/adapters/eventlog-rt-adapter.ts:13`、`176-177`
- `src/lib/adapters/timeblock-rt-adapter.ts:7`、`160-161`
- `src/lib/adapters/agent-session-rt-adapter.ts:12`、`219-220`

也就是说，前端到 RT 的默认 transport scope 仍不是 `archive_id`，而是 “当前 profile 或 legacy user 对应的 `user_id` query”。

`src/lib/adapters/proposal-rt-adapter.test.ts:105-125`、`195-223` 甚至把这个协议固化进测试：期望 URL 必须是 `...?user_id=anonymous`。这已经是行为契约，不是随手替换一个字段名就完了。

### 4. RT 内部仍以 `profile_id` / `user_id` 双别名折叠成 `scope_key`

这层断层最明显：

- `crates/exomind-runtime/src/routes/proposals.rs:15-33` 定义了同时接受 `profile_id` 和 `user_id` 的 query；`227-232` 直接 `profile_id.or(user_id)` 折叠成 `scope_key`
- `crates/exomind-runtime/src/routes/tasks.rs:18-30`、`42-48`、`63-70`、`117-120`、`154-159`、`192-208` 也是相同模式
- `crates/exomind-runtime/src/routes/timeblocks.rs:15-33`、`107-123`、`159-189`、`475-483` 同样如此
- `crates/exomind-runtime/src/routes/eventlog.rs:26-34`、`36-44`、`57-60`、`273-339` 则更旧，整个路由只认 `user_id`

也就是说，RT 没有真正的 archive-scope 协议。它现在实际跑的是：

1. 任务/时间块/提案：接受 `profile_id` 或 `user_id`
2. eventlog：只接受 `user_id`
3. 内部统一：全部降成一个无语义的 `scope_key`

这是“协议兼容层 + 通用 scope 抽象”，不是 “archive 语义已经落地”。

### 5. `scopeKey` 已经成为跨域复制协议的通用分片键

`crates/exomind-runtime/src/routes/proposals.rs:234-254`、`crates/exomind-runtime/src/routes/tasks.rs:476-491`、`crates/exomind-runtime/src/routes/timeblocks.rs:115-123`、`159-188`、`crates/exomind-runtime/src/routes/eventlog.rs:216-246` 都会把复制 payload 写成 `scopeKey`。

前端复制服务又把这个 `scopeKey` 反向绑定回当前 profile：

- `src/lib/services/ecs-eventlog-replication.service.ts:49-64` 把复制 payload 的 `scopeKey` 直接设为 `getCurrentProfileOrLegacyId()`
- `src/lib/services/ecs-eventlog-replication.service.ts:144-162` 用 `payload.scopeKey !== currentScopeKey` 做去重过滤

同样的模式也出现在 task/timeblock/reminder/active-block 复制服务检索结果中，但就 eventlog 这一条已经足够说明：当前跨端复制不是 archive registry 驱动，而是 generic `scopeKey` 驱动，而这个 `scopeKey` 的实际来源仍是 profile/user 旧原语。

### 6. 旧原语不仅存在于内核，还存在于底层存储命名空间

`crates/exomind-runtime/src/eventlog.rs:114-119`、`124-143`、`146-173`、`289-312` 显示 eventlog store 会把 `user_id` sanitize 后用于：

- watcher 通知键
- SQLite 查询参数
- JSON 文件名、Markdown mirror 文件名、checkpoint 文件名
- `/profiles` 的已知 scope 发现

`crates/exomind-runtime/src/task/store.rs:61-72`、`185-189`、`227-253` 说明 task store 以 `scope_key` 做内存/SQLite 分片，默认值是 `anonymous`。

`crates/exomind-runtime/src/timeblock_sqlite.rs:11`、`39-53`、`89-131`、`136-180`、`213-257`、`291-357` 说明 timeblock、planner windows、active block 全部落到 SQLite 的 `scope_key` 列。

前端 legacy 存储同样如此：

- `src/lib/storage/event-storage.ts:124-145`、`176-180` 用当前 user/profile id 拼出 `events_${userId}` 的 PouchDB 名称
- `src/lib/storage/active-block-storage.ts:72-86`、`92-101` 用当前 user/profile id 生成 `active_blocks_${safeUserId}` 数据库名

这已经不只是“字段名旧”，而是“现有数据分区键旧”。

### 7. RT 自己仍然没有一等 `archive` 元信息，而是从旧 scope 反推出 `profiles`

`crates/exomind-runtime/src/routes/profiles.rs:29-47` 的 `list_profiles()`，不是读取档案注册表，而是扫描 `eventlog_store.list_known_user_ids()`；然后：

- 过滤掉 `"anonymous"`（`:37`）
- 对 `profile-` 前缀做 slug/displayName 推导（`:38-64`）

这说明 RT 目前没有“档案注册表”，只有“哪些 `user_id` 写过 eventlog”的旧发现机制。它无法承载文档里要求的默认档案、正式档案升级、集体档案同型、锁定/占用状态等 OS 层语义。

### 8. UI 仍是“单活 profile/account 切换器”，不是“archive switcher + ArchiveSession/UiSession”

`src/ui/stores/sync-store.ts:45-47`、`191-192` 只有 `activeProfileId` 和 `unlockedProfileIds`，没有任何 `activeArchiveId` 或 `UiSession` 状态。

`src/ui/app/components/DesktopSidebarAccountEntry.tsx:29-43` 直接从 `useSyncStore()` 读取 `isLoggedIn / currentUser / activeProfileId`，标题还是“未打开档案”，副标题走 “仅本地档案 · slug / 点击打开或创建本地档案”。

`src/ui/app/components/SwitchAccountSheet.tsx:20-27`、`57-64`、`118-120`、`171-177`、`248-256` 的组件名就叫 `SwitchAccountSheet`，它管理的是 `users` 列表、`selectedUser`、`login/register/logout`，只是把文案局部改成了“档案”。这不是文档里要求的“档案切换器”，而是旧 account/profile picker 的延续。

### 9. Agent 相关入口已经出现“双重作用域通道”

`src/lib/adapters/agent-session-rt-adapter.ts:104-129` 会把显式的 `scopeKey` 写进请求体；但同一个 adapter 的 URL 还是统一经过 `appendRuntimeProfileScope()`，因此 transport 层依然会附带 `user_id` query（`:219-220`）。

RT 路由 `crates/exomind-runtime/src/routes/agent_sessions.rs:17-32`、`40-58` 只消费 body 里的 `scope_key`，并不读取 query。这意味着当前 agent 会话入口已经同时存在：

- 一个“业务层显式 scopeKey”
- 一个“transport 层隐式 user_id”

虽然这里暂时没撞出 bug，但这正好说明现有系统里“作用域”已经不是一个单一字段，rename 并不能自动对齐这些通道。

## 为什么这不是简单 rename

### 1. 新文档换掉的是“对象模型”，不是“展示名”

文档要求的是：

- `archive` 取代 `profile` 成为核心对象（`docs/plans/2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md:15-30`）
- `archive_id` 取代旧主键语义，统一承载个人档案和集体档案（`docs/plans/2026-04-06-multi-archive-and-collective-settled-decisions.md:30-35`、`102-107`、`214-245`）
- `ArchiveSession` / `UiSession` 取代“当前 active profile”的单活心智（`docs/plans/2026-04-07-archive-session-and-ui-session-clarifications.md:22-55`、`58-87`）

而代码当前仍然以“单个 active profile + 若干 unlocked profiles”组织会话（`src/lib/profile/types.ts:53-57`，`src/ui/stores/sync-store.ts:43-47`、`226-244`）。这两者不是词汇差异，而是运行模型差异。

### 2. 旧原语已经分裂成多层协议，rename 目标不是一个字段

当前作用域至少有四套名字：

- 本地主键：`profileId`
- 持久会话：`activeProfileId / unlockedProfileIds`
- HTTP query：`profile_id` / `user_id`
- 复制与工具链：`scopeKey`

这些名字今天虽然大多指向“同一个字符串”，但它们存在于不同层，承担不同兼容责任。`crates/exomind-cli/src/profile_scope.rs:14-47` 就把这种不一致写死了：tasks/proposals 发 `profile_id`，eventlog 发 `user_id`。这说明旧协议不是一层，而是多层历史叠加。

### 3. 作用域值已经深入存储布局，rename 会触及数据迁移

`profile-${slug}` 是 profile 本地主键格式（`src/lib/profile/profile-storage.ts:85-88`）；`user_id` / `scope_key` 又被用作：

- eventlog 文件名与 SQLite 分片键（`crates/exomind-runtime/src/eventlog.rs:298-312`）
- task SQLite scope 列（`crates/exomind-runtime/src/task/store.rs:61-72`、`185-189`）
- timeblock / planner windows / active block 的 SQLite `scope_key`（`crates/exomind-runtime/src/timeblock_sqlite.rs:39-53`、`89-131`、`213-257`、`291-357`）
- PouchDB 本地库名 `events_${userId}` / `active_blocks_${safeUserId}`（`src/lib/storage/event-storage.ts:139-145`、`176-180`；`src/lib/storage/active-block-storage.ts:76-86`、`92-101`）

只改代码符号，不处理这些真实命名空间，迁移后读到的就是空库。

### 4. 兼容桥已经存在，说明仓库在承受历史债而不是纯净状态

`src/lib/profile/profile-storage.ts:245-315` 不是一个全新 archive 系统，而是 “legacy users -> profile” 的过渡层；`src/ui/stores/sync-store.ts:140-165` 也在做 “legacy sync credentials -> identity link” 迁移。

这意味着仓库今天处在“第二代过渡态”。如果再直接做 `profile -> archive` rename，而不先定义 profile 与 archive 的映射关系，只会在现有迁移桥上再叠一层桥，复杂度继续上升。

### 5. 文档要求的 OS 层对象，代码里根本还不存在

文档要求默认档案、运行中档案、已占用、已锁定、ArchiveSession、UiSession、默认档案升级为正式档案（`docs/plans/2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md:33-45`、`79-108`、`134-153`）。

当前代码只有：

- 单活 `activeProfileId`
- 一个从 eventlog 反推的 `/profiles` 列表（`crates/exomind-runtime/src/routes/profiles.rs:29-47`）
- 若干 scope-isolated 数据 API

所以真正缺的不是 rename，而是 archive registry、archive session store、UI session occupancy、默认档案生命周期这些对象本身。

## 迁移阻力

### 1. 先前 profile 架构已经部分落地，代码会自然抗拒直接覆盖

`docs/plans/2026-03-07-user-system-hybrid-identity-architecture.md:152-155`、`273-279`、`295-316`、`484-490`、`607-610` 明确把上一轮路线写成：

- `profileId` 作为本地数据分库和内部关联根键
- `currentUser -> activeProfileId`
- EventLog / Task / TimeBlock 存储按 `profileId` 隔离

这套设计不是偶然实现，而是上一阶段刻意推进的结果。archive 迁移现在面对的不是零散旧词，而是一个已经“半完成”的 profile-based identity/scope architecture。

### 2. RT 协议当前不一致，迁移必须先定 canonical wire primitive

今天的事实是：

- eventlog 只认 `user_id`（`crates/exomind-runtime/src/routes/eventlog.rs:26-34`、`273-339`）
- task / timeblock / proposal 认 `profile_id` 和 `user_id` 双别名（`crates/exomind-runtime/src/routes/tasks.rs:18-30`、`117-120`；`crates/exomind-runtime/src/routes/timeblocks.rs:15-33`、`481-483`；`crates/exomind-runtime/src/routes/proposals.rs:15-33`、`227-232`）
- agent session 走 body `scopeKey`（`crates/exomind-runtime/src/routes/agent_sessions.rs:17-32`）

如果不先定“wire 上到底是 `archive_id`、`archive_scope`、还是继续 generic `scopeKey`”，就没法安全替换前端 helper、CLI flags、复制 payload、后端 query parser。

### 3. 默认 `anonymous` 作用域是实打实的数据分区，不是 UI 文案

`src/lib/profile/profile-storage.ts:314-315`、`crates/exomind-runtime/src/task/store.rs:61-72`、`crates/exomind-runtime/src/timeblock_sqlite.rs:11`、`crates/exomind-runtime/src/routes/profiles.rs:37-42` 都在承认一个事实：系统里存在默认匿名/空壳 scope。

但文档现在要求的是“固定存在的本地默认档案”，并且这个默认档案还能升级为正式档案（`docs/plans/2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md:63-76`、`97-108`）。

这两者不是同义词。`anonymous` 是无元信息分区；“默认档案”是 OS 层一等对象。迁移要解决的是“anonymous scope 如何升级成 default archive”，不是把匿名字符串换个名字。

### 4. 复制和工具链已经把 `scopeKey` 当成跨域公共接口

一旦 proposal/task/timeblock/eventlog 复制协议里的 `scopeKey` 改义，前端 ECS 投影、Signal 处理、mesh relay、agent preset/tool 取数都会受影响。单看以下几处就足够：

- `crates/exomind-runtime/src/routes/proposals.rs:234-254`
- `crates/exomind-runtime/src/routes/tasks.rs:476-491`
- `crates/exomind-runtime/src/routes/timeblocks.rs:115-123`、`159-188`
- `crates/exomind-runtime/src/routes/eventlog.rs:216-246`
- `src/lib/services/ecs-eventlog-replication.service.ts:49-64`、`144-162`
- `src/lib/adapters/agent-session-rt-adapter.ts:123`、`219-220`

这说明 scope migration 不是 profile 子系统内改名，而是复制和 agent tool sourcing 的公共接口迁移。

### 5. UI 入口和交互模型仍然围绕“打开/切换本地档案”而不是“连接/切换 ArchiveSession”

`src/ui/app/components/DesktopSidebarAccountEntry.tsx:29-43`、`src/ui/app/components/SwitchAccountSheet.tsx:171-177`、`248-256` 的交互仍是：

- 进入一个 sheet
- 在本地 profile 列表里选一个
- 输入密码解锁
- 登出当前档案

文档则要求“档案切换器 + 运行中/占用/锁定状态 + 单 UiSession + 默认档案升级”。UI 迁移阻力不是字面 rename，而是交互模型完全不同。

## 建议的后续验证问题

下面这些问题不先定，代码迁移一定会继续打补丁：

1. `archive_id` 是否等价于今天的 `profileId`？
   如果等价，迁移主要是协议和模型换名；如果不等价，就必须先定义 profile -> archive 的映射表和双向查找规则。

2. 默认档案的稳定主键是什么？
   今天默认回退是 `anonymous`（`src/lib/profile/profile-storage.ts:314-315`），文档要的是固定存在的默认档案（`docs/plans/2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md:63-76`）。这两者怎样映射，必须先定。

3. RT 的 canonical scope wire primitive 到底是什么？
   要决定：
   - HTTP query 是否统一成 `archive_id`
   - body 里的 `scopeKey` 是否继续保留为 generic abstraction
   - `profile_id` / `user_id` 的兼容窗口保留多久

4. RT 是否要新增一等 archive registry？
   只靠 `eventlog_store.list_known_user_ids()`（`crates/exomind-runtime/src/routes/profiles.rs:32-47`）不可能承载默认档案、正式档案、集体档案、锁定状态、占用状态。需要确认是否新建 metadata table/store。

5. `ArchiveSession` 与 `UiSession` 的真实落点在哪一层？
   是写进现有 `session_store`，还是另建 archive session store / ui session store？如果不回答这个问题，文档里的会话边界永远只是计划文本。

6. 当前 `scopeKey` 在集体档案阶段是否仍然等于单个 archive？
   文档已经要求“集体档案有自己的 ArchiveSession，但 UI 接入的是成员座席”（`docs/plans/2026-04-06-multi-archive-and-collective-settled-decisions.md:102-107`）。如果未来 `scopeKey` 需要表达 seat scope，而不只是 archive scope，那么这轮迁移就更不能直接做字符串 rename。

7. 本地身份绑定与同步凭据是否同步 rename？
   当前仍是 `profileId` / `localProfileId` / IdentityLink(profileId)（`src/lib/profile/identity-link-storage.ts:53-59`、`69-129`；`src/environment/interfaces/sync.port.ts:101-114`）。如果 archive 成为核心对象，这套边界要不要一并升级成 `archiveId / localArchiveId`，需要明确。

8. 数据迁移采用什么策略？
   至少要回答：
   - localStorage 的 `exomind:profiles:*` / `exomind:profile-session` 怎么双读写
   - PouchDB `events_${userId}` / `active_blocks_${userId}` 如何懒迁移
   - RT SQLite `scope_key` 与 eventlog `user_id` 如何兼容旧数据
   - CLI 和测试在兼容窗口内如何继续工作

## 结论

当前仓库的真实状态可以概括成一句话：**文档层已经把核心对象、会话边界和 OS 层心智迁到了 archive；代码层仍然运行在 profileId + user_id + scopeKey + anonymous 的过渡体系上。**

所以这轮迁移的真正工作量，不是把 `profile` 搜索替换成 `archive`，而是先决定：

- 什么是 archive 的稳定主键
- 什么是 archive session / ui session 的真实持久层
- 什么是 canonical wire scope
- 怎样把现有 profile/user/scopeKey 三套兼容层收束为一套 archive 语义

这些问题没定之前，任何“先 rename 一部分再说”的推进方式，都会继续制造桥接层，而不是消灭桥接层。
