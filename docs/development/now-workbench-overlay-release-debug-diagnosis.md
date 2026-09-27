# Now Workbench Overlay release/debug 行为不一致诊断

> 日期：2026-06-07
> 状态：Phase 0 止血已落地；Phase 1+ 待根治
> 范围：0.4.16 版本悬浮工作台（`now-workbench-overlay`）在 debug 构建中可用、release 构建中失效的问题。

## 一句话结论

release/debug 行为不一致不是 release 单独坏了，而是 debug 偶然满足了错误假设：UI 在 RT 真实端口与运行状态稳定之前就开始工作，并用默认端口、localStorage 镜像或一次性事件作为临时真相源。

正确方向是建立 **RT readiness gate**：UI 在 RT 明确进入可用状态前只能显示「启动中 / 连接中」，不得发起任务、时间块、事件流、配置等业务读写，也不得自行裁决当前端口或当前档案。

## 当前代码状态

Phase 0 止血修复已落地到 `dev`：

- 提交：`c6a8fac9 fix(overlay): gate workbench on runtime readiness`
- 原子端口发布：`rememberEmbeddedRuntimeStatus()` 先更新 `_ipcPort`，再持久化 runtime status 并广播 target changed。
- 调用顺序收敛：`runtime-config-adapter`、`useSignalStream`、`tauri-runtime-adapter` 不再手写“先广播、后更新端口”的顺序。
- overlay 启动门禁：`NowWorkbenchOverlayPage` 在 Tauri embedded RT `running && port > 0` 前只显示 `now-overlay-runtime-starting`，不挂载 controller / SSE。
- release 可观测性：`now-workbench-overlay` capability 增加 `log:default`，release 日志能进入 Tauri log。
- 文档定位：本文件记录 release/debug 不一致根因、已落地止血、后续根治边界；不是普通变更日志。

## 用户侧架构判断

本问题的关键原则：

- 一切真相源在 RT。
- 一切不一致的裁决源也应该在 RT。
- UI 不应在 RT 端口稳定前正式启动；在此之前只能呈现启动中状态。
- overlay 不应使用自己的 localStorage 裁决当前档案、当前端口、当前时间块状态。

这不是单纯 UI 体验偏好，而是避免 debug/release、主窗口/overlay、旧缓存/真实 RT 之间继续分叉的系统不变量。

## 通信模型澄清

这个问题不能只按“overlay 页面坏了”理解。当前系统至少有四个参与方：

| 参与方 | 职责 | 能裁决什么 | 不能裁决什么 |
|--------|------|------------|--------------|
| Tauri 后端控制面 | 启停 embedded RT、暴露 IPC 命令、管理 WebView 窗口 | embedded RT 是否 running、真实 host/port、窗口生命周期 | 业务任务、时间块、事件流内容 |
| ExoMind RT 数据面 | 提供任务、时间块、事件流、配置等 HTTP/SSE API | 业务状态真相 | UI 是否已经挂载、WebView 间事件送达 |
| 主窗口 WebView | 主 UI 投影、profile 管理、用户操作入口 | 自己的 UI 状态 | overlay 的 JS 模块状态、RT 真实端口 |
| overlay WebView | 悬浮工作台 UI 投影、局部交互入口 | 自己的显示状态 | 当前端口、当前档案、任务/时间块真相 |

关键结论：

- 主窗口和 overlay 是两个独立 WebView；`src/config/runtime-target.ts` 中的模块级 `_ipcPort` 不会跨 WebView 共享。
- Tauri event 可以桥接 profile、窗口控制、请求通知，但不能替代 RT readiness。
- localStorage 只能做镜像或兼容 fallback，不能作为 release overlay 的端口/档案裁决源。
- “一切真相源在 RT”需要拆成两层：RT 生命周期与端口真相在 Tauri 控制面，业务状态真相在 RT 数据面。

## 已核实的代码事实

### 1. `resolveEmbeddedPort()` 在 Tauri 中会静默回退默认端口

`src/config/runtime-target.ts` 中的 `resolveEmbeddedPort()` 依赖模块级 `_ipcPort`。如果 `_ipcPort` 尚未被填充：

- Web / debug 非 Tauri 场景允许使用默认端口 `9124`。
- Tauri 场景也会警告后继续返回默认端口 `9124`。

这使 release 版在 RT 未就绪或端口随机化时，仍可能先构造出指向 `9124` 的 RT client / SSE client。

相关位置：

- `src/config/runtime-target.ts:221` — `fetchEmbeddedPortFromIpc()` 只调用一次 `runtime_service_status`。
- `src/config/runtime-target.ts:240` — `resolveEmbeddedPort()` 在 `_ipcPort` 为空时 fallback 到默认端口。
- `src/config/runtime-target.ts:470` — `getSelectedRuntimeTarget()` 同步调用 `resolveEmbeddedPort()`。

### 2. 端口状态广播顺序存在公共 bug

多处代码在拿到 RT status 后，先调用 `persistEmbeddedRuntimeStatus()`，后调用 `updateEmbeddedPortFromTransport()`：

- `src/config/runtime-config-adapter.ts:249`
- `src/ui/hooks/useSignalStream.ts:146`
- `src/lib/adapters/tauri-runtime-adapter.ts:24`

但 `persistEmbeddedRuntimeStatus()` 内部会立即触发 runtime target changed 事件：

- `src/config/runtime-target.ts:502`

因此事件触发时 `_ipcPort` 仍可能为空，监听者通过 `getSelectedRuntimeTarget()` 得到的仍是默认 `9124`。这就是“明明刚拿到真实端口，却广播了旧端口”的根因。

### 3. release 下 overlay 更容易早于 RT 可用而启动

Tauri setup 中当前顺序是：

1. 预热 voice overlay。
2. 预热 now workbench overlay。
3. 设置 runtime 数据目录。
4. 异步启动 embedded RT。

相关位置：

- `src-tauri/src/lib.rs:346` — 预热 voice overlay。
- `src-tauri/src/lib.rs:349` — 预热 now workbench overlay。
- `src-tauri/src/lib.rs:430` — 异步启动 embedded RT。

debug 下端口通常固定、启动较慢且控制台可见；release 下端口可能被占用并切到随机端口，overlay 又可能已经启动，所以同一错误假设在 release 中更容易暴露。

### 4. overlay 入口缺少主窗口同等 runtime bootstrap

主窗口启动前会执行：

- `fetchEmbeddedPortFromIpc()`
- `hydratePersistedRuntimeTargetConfig()`
- `bootstrapRuntimeConfig()`

相关位置：

- `src/main.tsx:23`

overlay 入口只执行：

- `fetchEmbeddedPortFromIpc()`
- `hydratePersistedRuntimeTargetConfig()`
- `ensureProfileStorageMigrated()`

相关位置：

- `src/now-workbench-overlay-main.tsx:58`

这意味着 overlay 缺少 `bootstrapRuntimeConfig()` 的运行时配置与重试链路。当首次 `runtime_service_status` 看到 RT 未运行时，overlay 更容易带着默认端口进入 UI。

### 5. release overlay 日志能力与主窗口不对等

主窗口 capability 有 `log:default`：

- `src-tauri/capabilities/default.json:17`

now workbench overlay capability 没有：

- `src-tauri/capabilities/now-workbench-overlay.json:6`

因此 release 版里 overlay 前端日志不能稳定进入 Tauri log；debug 下靠 WebView 控制台能看到，不代表 release 具备同等可观测性。

### 6. profile 握手仍有一次性事件风险

当前主窗口 overlay service 在初始化中先尝试发送 profile，再注册 overlay 请求监听：

- `src/services/now-workbench-overlay.service.ts:37`
- `src/services/now-workbench-overlay.service.ts:61`

overlay 侧只主动请求一次 profile：

- `src/ui/app/overlay/use-now-workbench-overlay-controller.ts:239`

如果主窗口监听尚未就绪，或者 profile 当时尚未进入 `useSyncStore`，overlay 可能长期停在 profile 未就绪状态。

## 回归测试证据

原始复现用例：

```powershell
npx vitest run tests/unit/ui/use-signal-stream.m4.test.tsx -t "waits for embedded runtime" --reporter=verbose
```

修复前结果：失败。

失败含义：测试准备了第二次 `runtime_service_status` 返回真实端口 `48202`，但 `SignalStreamService` 实际仍以 `9124` 创建连接。这个失败与 release 版 overlay SSE 连错端口的问题一致。

这说明问题不是现场日志混乱导致的错觉，而是当前代码路径可稳定复现的时序 bug。

修复后最小回归：

```powershell
npx vitest run tests/unit/config/runtime-target.test.ts tests/unit/pages/NowWorkbenchOverlayPage.runtime-readiness.test.tsx tests/unit/tauri/now-workbench-overlay-capability.test.ts --reporter=verbose
```

结果：`3` 个测试文件、`13` 个测试通过。

覆盖点：

- runtime target changed 广播前已更新 IPC 端口缓存。
- overlay 在 RT 未 running 前不挂载业务 hook。
- overlay release capability 包含 `log:default`。

补充定向回归：

```powershell
npx vitest run tests/unit/ui/use-signal-stream.m4.test.tsx -t "waits for embedded runtime" --reporter=verbose
```

结果：通过；`SignalStreamService` 使用第二次 status 返回的随机端口 `48202`，不再使用默认 `9124`。

## 为什么 debug 看起来正常

debug 构建通常具备以下偶然条件：

- RT 端口更可能就是默认 `9124`。
- Vite/HMR 与开发工具链让启动节奏更慢，异步状态更容易在 UI 真正使用前补齐。
- WebView 控制台可见，开发者能直接看到 overlay 日志。
- 开发现场常只有一个活动实例，端口冲突概率较低。

这些条件降低了错误假设暴露概率，但没有消除错误假设本身。

## 为什么 release 暴露问题

release 构建更接近真实环境：

- embedded RT 可能因端口占用切到随机端口。
- Tauri setup 预热 overlay 早于 embedded RT 异步启动完成。
- `fetchEmbeddedPortFromIpc()` 若首次看到 RT 未运行，不会等待到 running。
- 业务 adapter 与 SSE hook 可以在端口未稳定时同步读取 runtime target。
- overlay 缺少 log capability，失败后观察困难。

因此 release 不是制造了新问题，而是把 debug 掩盖的系统竞态暴露出来。

## Release smoke 证据

验证方式必须模拟普通用户路径：正常构建 release exe、直接打开构建后的 exe，不注入固定 RT 端口。

构建前显式清空端口环境变量：

```powershell
Remove-Item Env:\EXOMIND_RT_PORT -ErrorAction SilentlyContinue
Remove-Item Env:\EXOMIND_RT_BIND -ErrorAction SilentlyContinue
Remove-Item Env:\VITE_EXOMIND_RT_PORT -ErrorAction SilentlyContinue
Remove-Item Env:\VITE_EXOMIND_RT_BIND -ErrorAction SilentlyContinue
bun run tauri build --no-bundle
```

本次验证现场：

| 实例 | PID | exe | RT 监听端口 | 结论 |
|------|-----|-----|-------------|------|
| 旧版正在使用实例 | `66184` | `H:\A137442\Program\Tool\ExoMind\exomind.exe` | `62417` | 保留运行，不触碰 |
| 新 release 构建产物 | `142120` | `G:\exomind-cargo-target\release\exomind.exe` | `47072` | 自动避开冲突并启动成功 |

`47072` 是本次运行自动选择的空闲端口，不是固定配置。验收重点是“release 版能在 `62417` 被占用时自动选择新端口，并且 UI / SSE 使用同一个新端口”。

HTTP 验证：

- `http://127.0.0.1:47072/health` -> `200`
- `http://127.0.0.1:47072/topology` -> `200`
- `http://127.0.0.1:47072/config?scope=user` -> `200`
- `http://127.0.0.1:47072/timeblocks/active` -> `200`
- `http://127.0.0.1:47072/tasks?include_cancelled=true` -> `200`

Tauri log 验证：

```text
[SignalStream] connect:start target=http://127.0.0.1:47072 agentId=ui heartbeat=30s resume=no
[SignalTransport] openStream:start url=http://127.0.0.1:47072/signals/stream?agent_id=ui&heartbeat_interval=30 lastEventId=none auth=none
[SignalStream] SSE connection started (embedded:127.0.0.1:47072)
[SignalTransport] openStream:response url=http://127.0.0.1:47072/signals/stream?agent_id=ui&heartbeat_interval=30 status=200 contentType=text/event-stream body=present
```

结论：Phase 0 止血标准已满足。release 构建在端口冲突场景下不再落回默认 `9124`，也没有误用旧实例端口 `62417`。

## 根除方向

### P0：建立 RT readiness gate

引入明确的运行状态：

```text
unknown -> starting -> running(host, port, hostId) | external | failed
```

规则：

- Tauri 下端口未知时，不得静默 fallback 到 `9124`。
- UI 在 `running` 或明确 `external` 前只能显示启动中状态。
- 任务、时间块、事件流、配置等业务读写必须从 readiness 派生 target。
- overlay 与主窗口共享同一套 readiness 语义。

### P1：修正端口状态更新顺序

所有拿到 running status 的路径都应先更新 `_ipcPort`，再写入 runtime status 镜像并广播 target changed。

涉及位置：

- `src/config/runtime-config-adapter.ts`
- `src/ui/hooks/useSignalStream.ts`
- `src/lib/adapters/tauri-runtime-adapter.ts`
- `src/config/runtime-target.ts`

### P1：overlay 入口补齐 runtime bootstrap

overlay 入口应与主窗口一样执行 runtime config bootstrap，或者接入统一的 readiness bootstrap，而不是只做一次 `fetchEmbeddedPortFromIpc()`。

涉及位置：

- `src/now-workbench-overlay-main.tsx`
- `src/main.tsx`

### P1：补齐 release 可观测性

now workbench overlay capability 应加入 `log:default`，并加单测防止回退。

涉及位置：

- `src-tauri/capabilities/now-workbench-overlay.json`
- `tests/unit/tauri/now-workbench-overlay-capability.test.ts`

### P2：profile 握手改为可重试 / 可订阅

profile 不应依赖一次性事件碰巧送达。

建议方向：

- 主窗口先注册 `overlay-request-profile` listener，再创建/显示 overlay。
- 主窗口订阅 `useSyncStore.activeProfileId` 变化，并主动向 overlay 广播。
- overlay 在未收到 profile 前保持「启动中 / 等待档案」状态并定时重试请求。
- overlay 不把自己的 localStorage 作为当前 profile 真相源。

## 可选修复路线与取舍

### 路线 A：端口发布顺序止血

做法：

- 在 `src/config/runtime-target.ts` 增加统一入口，例如 `rememberEmbeddedRuntimeStatus(status)`。
- 该入口必须先写 `_ipcPort`，再写 runtime status 镜像，最后广播 runtime target changed。
- 替换 `src/config/runtime-config-adapter.ts`、`src/ui/hooks/useSignalStream.ts`、`src/lib/adapters/tauri-runtime-adapter.ts` 中的手写顺序。

价值：

- 直接修复“明明拿到真实端口，却广播出默认端口 `9124`”的公共 bug。
- 改动小、可测试、爆炸半径低。

限制：

- 只能修正端口发布顺序，不能阻止 overlay 页面在 RT 未 ready 时启动业务 hook。

### 路线 B：overlay 启动门禁

做法：

- 在 overlay 根部建立 RT readiness gate。
- Tauri embedded 模式下，只有 `runtime_service_status` 返回 `running && port > 0` 后，才挂载 `useNowWorkbenchOverlayController()`、`useSignalStream()`、任务/时间块 UI。
- ready 前只显示「RT 启动中」或「等待运行时」。

价值：

- 直接切断 release 构建更快导致的业务抢跑。
- 与“UI 应在 RT 端口稳定后再正式启动”的系统不变量一致。

限制：

- 需要新增启动态 UI。
- 只能保证 overlay 自身；主窗口和其他入口仍需要后续统一 readiness 语义。

### 路线 C：主窗口与 overlay bootstrap 对齐

做法：

- overlay 入口补齐主窗口已有的 runtime bootstrap 链路，尤其是 `bootstrapRuntimeConfig()` 或等价的统一 readiness bootstrap。
- 避免主窗口与 overlay 使用两套启动协议。

价值：

- 降低“双 WebView 两套启动行为”的长期维护成本。
- 为后续统一 runtime readiness store 铺路。

限制：

- 如果没有路线 B 的 gate，bootstrap 对齐仍可能只是缓解 race，而不是消灭 race。

### 路线 D：架构根治

做法：

- 把 runtime target 从同步猜测值升级为明确状态机：`unknown -> starting -> running(host, port, hostId) | external | failed`。
- Tauri embedded 模式下移除业务路径里的静默 `9124` fallback。
- 所有 RT adapter / SSE / config transport 只消费 readiness 派生出的 target。

价值：

- 从系统层面根除 debug/release、主窗口/overlay、默认端口/真实端口之间的分叉。

限制：

- 改动面最大，应在止血修复验证稳定后作为第二阶段推进。

## 分阶段实施计划

### Phase 0：止血修复（已完成）

目标：让 release overlay 不再在端口未知时连错 `9124`，并恢复可观测性。

已完成改动：

1. 在 `src/config/runtime-target.ts` 增加 `rememberEmbeddedRuntimeStatus()` 原子状态发布函数。
2. 修正 `persistEmbeddedRuntimeStatus()` 与 `updateEmbeddedPortFromTransport()` 的调用顺序。
3. 在 overlay 根部加入 RT readiness gate，ready 前不挂载业务层。
4. 给 `src-tauri/capabilities/now-workbench-overlay.json` 增加 `log:default`。

验收：

- `useSignalStream` 在 RT 第二次返回随机端口时连接随机端口，而不是 `9124`。
- overlay 在 RT 未 running 前不挂载 controller / SSE。
- release overlay 日志可以通过 Tauri log 观察。
- release exe 在已有 `62417` 旧实例占用时自动选择新端口，并让 HTTP / SSE 使用同一端口。

### Phase 1：启动协议对齐

目标：主窗口与 overlay 使用同一套 RT readiness / runtime config bootstrap 语义。

改动：

1. overlay 入口补齐 `bootstrapRuntimeConfig()` 或接入统一 readiness bootstrap。
2. 把 `fetchEmbeddedPortFromIpc()` 从“一次性读取”升级为可等待 running 的启动辅助。
3. 把启动中状态区分为「等待 RT」「等待档案」「连接业务流」。

验收：

- 主窗口先开、overlay 后开；overlay 先预热、RT 后 running；RT 慢启动三种场景行为一致。
- 两个 WebView 的 runtime target 最终一致，且不依赖对方的 JS module state。

### Phase 2：profile 握手可靠化

目标：overlay 不再依赖一次性 profile event 的时序碰巧成功。

改动：

1. 主窗口先注册 `overlay-request-profile` listener，再创建或显示 overlay。
2. 主窗口订阅 active profile 变化并持续广播。
3. overlay 在 profile 未到达时定时重试请求，并显示「等待档案」。

验收：

- overlay 请求早于主窗口 profile ready 时，后续仍能收到 profile 并加载数据。
- overlay 不把自己的 localStorage 当作当前 profile 真相源。

### Phase 3：runtime target 根治

目标：移除 Tauri release 业务路径中的同步默认端口猜测。

改动：

1. 引入 runtime readiness 状态机。
2. Tauri embedded 模式下，端口未知不再返回 `9124`，而是表达为 unresolved / starting。
3. 所有 RT adapter、SSE hook、runtime config transport 改为从 readiness 派生 target。

验收：

- `9124` 只在 Web/dev fallback 或 RT 真实返回该端口时出现。
- 任意 UI 入口在 RT 未裁决前只能显示启动态，不能启动业务请求。

## 第一刀推荐

第一刀应合并路线 A 与路线 B，并同步补齐日志权限：

1. 端口状态原子发布。
2. overlay RT readiness gate。
3. overlay `log:default` capability。

理由：

- 当前 release/debug 不一致的主因是启动时序 race，而不是任务业务逻辑错误。
- 仅修 SSE 或 profile 都不能阻止其他业务 adapter 在错误端口上抢跑。
- 仅补 bootstrap 也不能保证业务 hook 不在 bootstrap 完成前被挂载。
- gate 能把“随机抢跑”变成“明确等待”，端口原子发布能把“广播旧端口”变成“广播真实端口”。

## 修复完成标准

最低止血标准：

- Tauri release 下业务请求不再静默落到默认 `9124`，除非 RT 真实端口就是 `9124`。
- overlay 在 RT `running && port > 0` 前只显示启动态，不启动 controller / SSE / 任务 / 时间块请求。
- runtime target changed 事件 detail 中的端口与 IPC/RT 返回端口一致。
- overlay release 日志可见。

根治标准：

- Tauri embedded 模式下，“端口未知”不能被表达成“默认端口 `9124`”。
- 主窗口、overlay 和后续其他 WebView 使用同一套 readiness 状态机。
- RT 生命周期真相由 Tauri 控制面裁决，业务真相由 RT 数据面裁决，UI 不自行裁决。

## 已知未根治边界

Phase 0 只解决 release 发版阻塞级问题，不等于 runtime target 架构根治完成：

- `resolveEmbeddedPort()` 在 Tauri `_ipcPort` 为空时仍会 fallback 到 `9124`，但 overlay 已通过 readiness gate 避免业务层抢跑。
- overlay 入口仍未完全补齐主窗口 `bootstrapRuntimeConfig()` 等价链路；后续应统一到 readiness bootstrap。
- profile 握手仍依赖 Tauri event 与 overlay 主动请求，尚未升级为可重试 / 可订阅协议。
- `useSignalStream` 完整测试文件存在与本次端口修复无关的既有 fixture 失败，应单独整理，不应混入本轮止血。

## 建议验证

最小回归测试：

1. 模拟 `runtime_service_status` 第一次返回 `running: false`，第二次返回随机端口。
2. 断言 `useSignalStream` 创建的 host 端口是随机端口，而不是 `9124`。
3. 断言 runtime target changed 事件 detail 中也是随机端口。
4. 断言 overlay capability 包含 `log:default`。
5. 模拟 overlay profile 请求早于主窗口 profile ready，断言后续仍能收到 profile 并加载任务/时间块。

人工 release smoke test：

1. 启动 release exe。
2. 确认 overlay 初始显示启动中，而不是直接连默认端口。
3. RT running 后 overlay 显示当前档案任务和 active timeblock。
4. 主窗口暂停/恢复时间块，overlay 同步变化。
5. Tauri log 中能看到 overlay 的 `SignalStream` / profile readiness / action debug 信息。

## 当前不应做的事

- 不应继续让 release 用户跑 debug 构建验证功能。
- 不应通过扩大 localStorage 共享来裁决当前端口或当前档案。
- 不应把 `9124` 当作 Tauri release 的默认真相。
- 不应只修 overlay 页面组件，而忽略 runtime target 公共状态流。
