# 2026-04-13 durable runtime 核心与 fallback/host-port 历史假设断层调查

> 状态：基于本仓库当前代码与文档的只读取证  
> 范围：`crates/exomind-runtime/src/lib.rs`、`crates/exomind-runtime/tests/runtime_startup.rs`、`src-tauri/src/commands/runtime_commands.rs`、`src-tauri/src/lib.rs`、`src/ui/app/pages/AgentsPage.tsx`、`docs/analysis/2026-04-10-open-issue-source-census.md`

## 1. 问题定义

这里的断层不是“runtime 还不够 durable”，而是两套时代的前提正在同时存在。

- 新前提：runtime 的身份、绑定地址和生命周期真相，应该来自 runtime 自己的持久化配置与实际启动结果，而不是来自桌面层预设的固定 host/port。
- 旧前提：桌面宿主仍然默认“loopback + 已知端口 + 缺省地址可猜测 + 外部 runtime 可用 host/port 探测代替统一真相源”。

当前代码已经明显向前迈了一步。runtime 库层已经支持持久化 `host_id`、接受 `port=0` 并在启动后回传真实绑定端口，Tauri 启动层也已经补上“固定端口占用时退回随机端口”的逻辑，见 `crates/exomind-runtime/src/lib.rs:43-61`、`crates/exomind-runtime/src/lib.rs:73-95`、`crates/exomind-runtime/tests/runtime_startup.rs:18-38`、`crates/exomind-runtime/tests/runtime_startup.rs:76-91`、`src-tauri/src/commands/runtime_commands.rs:820-929`。  
但同时，桌面入口、状态初始化、持久化外部地址缺省值、以及 UI 恢复逻辑仍在大量消费“预设 host/port”这个旧世界假设，见 `src-tauri/src/lib.rs:222-226`、`src-tauri/src/commands/runtime_commands.rs:35-48`、`src-tauri/src/commands/runtime_commands.rs:302-313`、`src/ui/app/pages/AgentsPage.tsx:765-775`。

因此，这个主题的核心不是“要不要继续做 durable runtime”，而是：**runtime 底层已经开始变 durable，但桌面层和 UI 层还没有完全承认“地址不是先验，而是启动结果”**。

## 2. runtime 底层已取得的新进展

### 2.1 `host_id` 已经从“进程瞬时值”变成“设备级持久化值”

`configured_host_id_from_env()` 不再只靠环境变量；当 `EXOMIND_RT_HOST_ID` 未显式设置时，它会从 `config.sqlite` 中 `load_or_create_persisted_runtime_identity(...)`，失败时才退到随机 UUID，见 `crates/exomind-runtime/src/lib.rs:73-95`。这说明 runtime 身份已经不再是“每次重启重生一次”的临时值。

更关键的是，库内测试已经把这件事写成了契约：

- `persisted_runtime_host_id_reuses_device_scope_config_entry()` 验证同一个 `config.sqlite` 下两次读取拿到同一个 `host_id`，并且值真正落在 `DEVICE_CONFIG_SCOPE`，见 `crates/exomind-runtime/src/lib.rs:2293-2325`。
- `persisted_runtime_device_id_reuses_device_scope_config_entry()` 与 `persisted_runtime_device_id_is_distinct_from_host_id()` 则把 `device_id` 与 `host_id` 的持久化和区分关系也写死了，见 `crates/exomind-runtime/src/lib.rs:2328-2363`。

这意味着“RT id 未做设备级持久化”已经不能再当作库层现状来描述。

### 2.2 `port=0` 已经是 runtime 启动契约，而不是旁路 hack

runtime 库把 `DEFAULT_RT_PORT` 定义为 `1949`，`configured_port_from_env()` 在无环境变量时返回这个默认值，见 `crates/exomind-runtime/src/lib.rs:43-61`。  
测试明确把两件事写成契约：

- 默认端口是 `1949`，见 `crates/exomind-runtime/tests/runtime_startup.rs:17-27`。
- `EXOMIND_RT_PORT=0` 被视为“随机分配”，不是非法输入，见 `crates/exomind-runtime/tests/runtime_startup.rs:29-38`。
- `start_with_options(... port: 0 ...)` 启动后，`handle.port()` 必须返回一个真实可用端口，且 host 仍为 `127.0.0.1`，见 `crates/exomind-runtime/tests/runtime_startup.rs:76-91`。

这说明 runtime 核心已经接受“地址是启动结果的一部分”，而不是“端口在启动前就先验确定”。

### 2.3 Tauri 启动层已经补上“固定端口失败 -> 随机端口”的收口逻辑

`src-tauri/src/commands/runtime_commands.rs` 当前的启动逻辑已经不是旧 census 所写的“固定端口 bind 失败就直接报错”。

- 当请求的是固定端口时，启动前会先尝试等待端口释放，并探测该端口上是否已经有健康 runtime；如果有，则直接把它视为 `external_runtime`，见 `src-tauri/src/commands/runtime_commands.rs:820-850`。
- 如果固定端口持续被非 runtime 占用，则把 `options.port = 0`，退回随机可用端口，见 `src-tauri/src/commands/runtime_commands.rs:842-849`。
- 如果启动过程中发生 `AddrInUse`，并且请求端口不是 `0`，也会再次退到随机端口并重试，见 `src-tauri/src/commands/runtime_commands.rs:852-879`。
- 启动成功后，状态里写入的是 `handle.host()`、`handle.port()` 和 `handle.host_id()`，不是请求值本身，见 `src-tauri/src/commands/runtime_commands.rs:901-929`。

这是一条非常重要的新进展：**桌面层已经开始接受“requested port”与“started port”可以不同，而且不同并不算错误”**。

## 3. 仍存在的 fallback 形状

### 3.1 启动链里仍然保留“健康探测即外部 runtime 复用”的分支

`mark_external_runtime_running()` 会把状态切到 `external_runtime = true`，并直接写入 `host`/`port`，但把 `host_id` 置为 `None`，见 `src-tauri/src/commands/runtime_commands.rs:718-731`。  
这意味着只要固定端口上已经有一个健康 runtime，桌面层就允许把“我自己拉起的 durable runtime”与“我碰巧探测到的外部 runtime”合并进同一条状态机，见 `src-tauri/src/commands/runtime_commands.rs:829-830`、`src-tauri/src/commands/runtime_commands.rs:858-865`。

这条分支不是 bug，但它保留了明显的历史味道：**宿主仍然允许用 host/port 探测来接管 runtime 真相，而不是只信 runtime 自己的持久 identity 与启动记录**。

### 3.2 缺失持久化外部地址文件时，代码仍会“伪造一个默认地址”

`load_runtime_external_address_from_path()` 在文件不存在时，不返回 unknown，也不要求调用方重新发现地址，而是直接回退到 `127.0.0.1:${DEFAULT_RT_PORT}`，见 `src-tauri/src/commands/runtime_commands.rs:302-313`。  
对应测试也把这件事视为预期行为，见 `src-tauri/src/commands/runtime_commands.rs:1341-1343`。

这是一个非常典型的历史 fallback：**当持久化真相缺失时，系统仍倾向于生成一个“应该差不多对”的默认地址，而不是承认真相未知**。

### 3.3 `RuntimeProcessState` 仍带着“未启动前先假定一个地址”的初值

`RuntimeProcessState::new()` 初始化时就写入：

- `host = "127.0.0.1"`
- `port = DEFAULT_RT_PORT`
- `external_runtime = false`

见 `src-tauri/src/commands/runtime_commands.rs:35-48`。

这表示桌面状态容器在 runtime 尚未启动、外部地址尚未解析、健康探测尚未完成之前，就已经持有一组“看起来像真相”的 host/port。  
只要上层组件在启动窗口里消费到这个状态，历史假设就会继续往上传播。

## 4. host/port 默认假设如何泄漏到上层

### 4.1 桌面入口仍显式维护另一套默认端口：`9124`

runtime 库默认端口是 `1949`，但 Tauri 入口 `resolve_embedded_runtime_port()` 在 `EXOMIND_RT_PORT` 缺失或非法时，回退到的是 `9124`，见 `src-tauri/src/lib.rs:222-226`。  
更强的问题是，这不是偶然留存；测试也把“非法值回退到 `9124`”写死了，见 `src-tauri/src/lib.rs:760-768`。

随后，桌面自动拉起 embedded runtime 时，会把这个 `runtime_port` 直接传进 `ensure_runtime_started(...)`，见 `src-tauri/src/lib.rs:407-418`。

这意味着当前桌面端内部事实上存在两套默认值：

- runtime 库层默认 `1949`，见 `crates/exomind-runtime/src/lib.rs:43-61`。
- Tauri embedded 启动入口默认 `9124`，见 `src-tauri/src/lib.rs:222-226`。

这不是单纯的“配置不同”。它会直接导致“哪一层是地址真相源”这个问题重新变模糊。

### 4.2 上层 UI 已经出现针对 `host_id`/重启窗口的补丁式恢复逻辑

`AgentsPage` 里已经长出一整套围绕 embedded runtime 重启窗口的补偿机制：

- 先定义 `EMBEDDED_RUNTIME_HOST_IDENTITY_SETTLING_MS = 1500`，见 `src/ui/app/pages/AgentsPage.tsx:765`。
- 当 `host_id` 还在 settling 时，终端自动恢复会被显式延后，理由就是 `"source-host-settling"`，见 `src/ui/app/pages/AgentsPage.tsx:5178-5203`。
- runtime 重启期间，断开的终端 session 会被“先保持活着”，而不是立即完成或清理，见 `src/ui/app/pages/AgentsPage.tsx:7331-7340`。
- 页面还会启动一个 `250ms * 16` 的 fast probe 去轮询 runtime 状态变化与重启完成，见 `src/ui/app/pages/AgentsPage.tsx:7733-7775`。

这些逻辑不是无意义的噪音。它们证明了同一件事：**上层并没有完全相信 runtime 状态是 durable 且自洽的，所以才需要围绕 host identity、startedAt、重启窗口做额外推断**。

### 4.3 上层泄漏的根因不是“UI 写得差”，而是桌面层仍输出了混合语义

桌面层当前至少输出三种不同语义的 runtime 状态：

- “我自己启动的 embedded runtime”，写入真实 `handle.host()/handle.port()/host_id`，见 `src-tauri/src/commands/runtime_commands.rs:920-929`。
- “探测到的 external runtime”，直接写 host/port，但 `host_id = None`，见 `src-tauri/src/commands/runtime_commands.rs:718-731`。
- “尚未真正启动，但状态容器已有默认 127.0.0.1:1949”，见 `src-tauri/src/commands/runtime_commands.rs:35-48`。

上层一旦同时消费这三类状态，又碰到 `src-tauri/src/lib.rs:222-226` 的 `9124` 默认端口分支，就很难只靠简单的“当前 runtime base URL”来收口。

## 5. 哪些 issue 判断已过时，需纠偏

### 5.1 `#896 bug(runtime-port)` 的核心诊断已经部分过时

`docs/analysis/2026-04-10-open-issue-source-census.md:190` 当前写的是：

- runtime 库层已支持 `port=0`
- 但 `src-tauri/src/commands/runtime_commands.rs` “仍未把 `AddrInUse` 自动重试到随机端口”

第二句已经不符合当前代码。当前代码在 `AddrInUse` 时，只要请求端口不是 `0` 且该端口上没有健康 runtime，就会把 `options.port = 0` 并继续重试，见 `src-tauri/src/commands/runtime_commands.rs:856-879`。  
因此，`#896` 现在不能再被描述成“桌面层还没有自动退随机端口”；更准确的说法应该是：**桌面层已经支持随机端口 fallback，但固定端口/外部探测/默认地址三套假设仍并存，导致 durable runtime 语义没有彻底收口**。

### 5.2 `#885 bug(sync/pairing)` 的“未做设备级持久化”说法已经不成立

`docs/analysis/2026-04-10-open-issue-source-census.md:200` 仍把 `#885` 归纳成“RT id 未做设备级持久化”。  
这个判断对当前库层也已经过时：

- `configured_host_id_from_env()` 已经把 `host_id` 绑定到 `config.sqlite`，见 `crates/exomind-runtime/src/lib.rs:73-95`。
- 测试 `persisted_runtime_host_id_reuses_device_scope_config_entry()` 已经验证重启后复用同一个 `host_id`，见 `crates/exomind-runtime/src/lib.rs:2293-2325`。

`#885` 现在更应该被缩窄成：**库层 identity persistence 已经存在，但桌面宿主与上层恢复逻辑仍然围绕 host/port 推断、外部 runtime 探测和短暂 `host_id=None` 状态运作，所以“配对关系稳定”仍未被端到端证明**。

## 6. 迁移阻力

### 6.1 端口默认值已经分叉，不是简单删一个常量就能修

当前至少存在两套默认端口语义：

- runtime core 的 `1949`，见 `crates/exomind-runtime/src/lib.rs:43-61`。
- embedded desktop 启动入口的 `9124`，见 `src-tauri/src/lib.rs:222-226`。

而 `runtime_commands.rs` 里状态初始化和外部地址缺失 fallback 走的又是 `DEFAULT_RT_PORT`，见 `src-tauri/src/commands/runtime_commands.rs:35-48`、`src-tauri/src/commands/runtime_commands.rs:302-313`。  
这意味着迁移时必须先明确“谁是 canonical default”，否则只是把分叉从一处搬到另一处。

### 6.2 `external_runtime` 分支在功能上有价值，但在语义上持续制造混合状态

自动复用健康 runtime 的能力本身有现实价值，尤其对热重载、并发启动竞争和外部 RT 接入都很有帮助，见 `src-tauri/src/commands/runtime_commands.rs:829-830`、`src-tauri/src/commands/runtime_commands.rs:858-865`。  
但只要这条分支仍然把 `host_id` 清空成 `None`，它就会继续逼迫上层围绕“是否刚重启 / host identity 是否 settling”写补丁，见 `src-tauri/src/commands/runtime_commands.rs:723-731` 与 `src/ui/app/pages/AgentsPage.tsx:5178-5203`。

### 6.3 UI 恢复逻辑已经把旧假设编码成行为依赖

一旦上层已经依赖：

- `host_id` 的短暂不可用
- `startedAt` 变化
- runtime 状态 probe
- 断开 session 延迟完成

那么后续再想把 runtime 状态收口成更简单的 durable 语义，就不能只改后端；必须同步验证 UI 恢复路径，见 `src/ui/app/pages/AgentsPage.tsx:765-775`、`src/ui/app/pages/AgentsPage.tsx:7331-7340`、`src/ui/app/pages/AgentsPage.tsx:7733-7775`。

### 6.4 现有 fallback 很多已经被测试固化

这不是“注释里还残留旧思路”，而是测试已经把部分历史 fallback 写成预期：

- 非法 embedded port 回退到 `9124`，见 `src-tauri/src/lib.rs:760-768`。
- 固定请求端口在无健康 runtime 时应退随机端口，见 `src-tauri/src/commands/runtime_commands.rs:1207-1210`。
- 外部地址文件缺失时应回退到 `127.0.0.1:${DEFAULT_RT_PORT}`，见 `src-tauri/src/commands/runtime_commands.rs:1341-1343`。

因此迁移不是删分支，而是先改契约，再改实现。

## 7. 建议的后续验证问题

1. `1949` 与 `9124` 到底谁才是桌面端 canonical default？
   如果桌面端确实要保留 `9124`，那 runtime core、runtime commands、持久化外部地址 fallback 和测试是否都应统一跟随；如果不要保留，就应该删除 `src-tauri/src/lib.rs:222-226` 这条单独默认。

2. 外部地址文件缺失时，API 是否应该返回“未知地址”而不是伪造 `127.0.0.1:${DEFAULT_RT_PORT}`？
   当前 `src-tauri/src/commands/runtime_commands.rs:302-313` 的行为会把“没有真相”伪装成“有一个默认真相”。

3. `external_runtime` 分支是否必须把 `host_id` 置空？
   当前 `mark_external_runtime_running()` 在 `src-tauri/src/commands/runtime_commands.rs:718-731` 里直接清空 `host_id`，这是上层 settling 逻辑的直接诱因之一。

4. UI 恢复是否可以改成依赖 runtime epoch / instance token，而不是 `host_id + startedAt + fast probe` 的组合推断？
   现在 `AgentsPage` 的恢复逻辑已经明显过于贴近宿主层时序，见 `src/ui/app/pages/AgentsPage.tsx:5178-5203`、`src/ui/app/pages/AgentsPage.tsx:7733-7775`。

5. 需要补哪些端到端验证来证明“库层 durable”已经传递到桌面层？
   当前至少缺两类验证：
   - 固定端口被占用时，桌面层最终展示与持久化的是否是**真实启动端口**。
   - runtime 重启后，PTY 恢复是否仍需要 `host identity settling` 窗口。

6. `#896` 和 `#885` 的 census 条目是否应从“未实现”改成“实现已前进，但诊断口径需收窄”？
   继续保留旧诊断会误导后续实现，把精力浪费在已补齐的底层契约上。

## 8. 结论

durable runtime 的底层核心已经明显前进了：身份持久化、`port=0`、真实绑定端口回传、固定端口占用时退随机端口，这些都已经进入代码和测试。问题不再是“runtime 还是完全脆弱的”。

当前真正的断层在于，桌面宿主和 UI 层还没有彻底放弃旧的 host/port 历史假设。它们仍然默认存在一个预设地址、允许外部探测分支覆盖 runtime 真相、并在上层围绕 `host_id`/重启窗口写补丁。  
如果不先收口这些旧假设，durable runtime 会继续停留在“库层正确、桌面层混合、UI 层补偿”的状态，而不是成为单一、稳定、可直接推理的运行时基础。
