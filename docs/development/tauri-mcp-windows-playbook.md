# Tauri MCP Windows Playbook

> 持续更新。用于沉淀在 Windows 环境下，使用 Tauri MCP 调试 ExoMind 外心桌面应用的实践经验、坑点与验证套路。

> 本文中的实例名、端口、窗口标题、route、SQLite 路径、报告路径、session/anchor id 等，除非明确写成“通用规则”，否则都只表示对应阶段的现场样例，复用时必须替换为当前实例真值。

## 目的

- 为后续 Agent 提供可复用的 Tauri MCP 调试路径，而不是每次从零摸索。
- 记录“当前 app 实际状态”和“持久化配置状态”不一致时的判定方法。
- 记录哪些目标可以直接依赖 Tauri MCP，哪些场景需要退回到 RT HTTP、日志、SQLite 与本地文件。

## 当前阶段：#806 / #810 终端生命周期联调

更新时间：`2026-04-02`

### 阶段目标

- 验证 `#806` 及其衍生 issue 的终端用户故事。
- 优先补齐 `#810`：Codex PTY 会话在默认/相对 workdir 场景下也能补写 `inner_session_id`，为重启后 resume 提供前提。
- 让 Tauri MCP 成为真实验收工具，而不是只停留在“已连接”。

### 已确认事实

- `driver_session status` 显示已连接：
  - `connected: true`
  - `identifier: com.exomind.app`
  - `port: 9223`
- 本地 Vite dev server 存活：
  - `0.0.0.0:1420` 正在监听
- 本地 Tauri 进程正在同时监听：
  - `0.0.0.0:9124`
  - `0.0.0.0:9223`
- 应用日志显示 embedded RT 的确启动成功，并且 webview 至少能成功连上：
  - `SignalTransport openStream ... status=200`
  - `target=http://127.0.0.1:9124`

### 当前发现的关键矛盾

- 持久化设置文件仍显示：
  - `runtime-target-mode.json` => `external`
  - `runtime-network-mode.json` => `lan`
  - `runtime-external-address.json` => `192.168.1.48:9124`
- 但同一时间，应用日志显示：
  - embedded RT 已在本机 `0.0.0.0:9124` 启动
  - 前端至少有一部分链路实际连的是 `http://127.0.0.1:9124`

### 这说明什么

- “用户此前看到的 `192.168.1.48:9124` 401” 不能直接等同于“本机 embedded RT 没启动”。
- 更可能的真实问题是：
  - 某些前端链路仍在读取旧的 external runtime 配置
- 另一些链路已经切回 embedded runtime
- 因此出现同一窗口内请求目标不一致、鉴权表现不一致、MCP 行为也不稳定

### 重要校正：先确认是不是读错了实例目录

- `bun run tauri dev` 不是直接使用 `%APPDATA%\com.exomind.app` 作为当前实例目录。
- `scripts/dev/tauri-wrapper.ps1` 会在 dev 模式下注入：
  - `EXOMIND_DEV_APP_DATA_DIR`
  - `EXOMIND_DEV_RUNTIME_DATA_DIR`
  - `EXOMIND_DEV_WEBVIEW_MAIN_DATA_DIR`
  - `EXOMIND_MCP_BRIDGE_BASE_PORT`
- 真实目录要通过 `scripts/dev/tauri-dev-instance-paths.ts` 解析。
- 当前工作区实际实例是：
  - `.tmp/tauri-dev-state/web-1420/app-data`
  - `.tmp/tauri-dev-state/web-1420/webview/main`

### 这次联调里已经证实的更正

- 之前读取 `%APPDATA%\com.exomind.app\settings\...` 得到 `external + 192.168.1.48:9124`，那不是当前 `tauri dev` 实例的真实设置。
- 当前 `web-1420` 实例的真实设置是：
  - `runtime-target-mode.json` => `embedded`
  - `runtime-network-mode.json` => `lan`
  - `runtime-external-address.json` => `192.168.1.48:9124`
- 这意味着：
  - external address 的旧值只是残留配置
  - 当前实例是否请求外部 RT，关键要看 `targetMode`
  - 不先校正实例目录，就会把别的实例配置误判成当前问题

### 当前 Tauri MCP 经验

- `driver_session status` 成功，不代表 app 内 RPC 一定可用。
- 当前阶段里，以下调用持续超时：
  - `ipc_get_backend_state`
  - `manage_window list`
  - `webview_dom_snapshot`
  - `read_logs source=console`
- 因此在 Windows 下要把 Tauri MCP 分成两层判断：
  - 第一层：Bridge/WebSocket 连接是否建立
  - 第二层：App 内 RPC / WebView 执行是否真的可响应

### 当前建议的调试顺序

1. 先看 `driver_session status`，确认 Bridge 已连接。
2. 再看端口：
   - `1420` 是否存活
   - `9124` 是否存活
   - `9223` 是否存活
3. 再读本地日志：
   - `C:\Users\<user>\AppData\Local\com.exomind.app\logs\exomind.log`
4. 再读持久化设置：
   - 优先读当前 dev 实例目录，例如：
   - `.tmp/tauri-dev-state/web-1420/app-data/settings/runtime-target-mode.json`
   - `.tmp/tauri-dev-state/web-1420/app-data/settings/runtime-network-mode.json`
   - `.tmp/tauri-dev-state/web-1420/app-data/settings/runtime-external-address.json`
   - `%APPDATA%\com.exomind.app\settings\...` 只作为 legacy shared 数据参考，不默认视为当前实例
5. 如果 MCP RPC 超时，不要卡住：
   - 退回用 RT HTTP + 日志 + SQLite/文件做旁证
   - 同时继续查 app 配置不一致问题

### 当前阶段的产品相关结论

- `#810` 的核心断点已经明确：
  - 前端补写 `inner_session_id` 时要求绝对路径
  - 后端此前会把默认/相对 workdir 落成 `.`
- 当前已实施修复方向：
  - RT `spawn()` 返回绝对 workdir
  - 前端 `PtySpawnDialog` 优先使用 RT 返回的 `result.workdir` 去做历史 session 绑定

### 当前阶段的测试结论

- 已通过：
  - `bunx tsc --noEmit`
  - `npx vitest run tests/unit/ui/agent-hub/pty-spawn-dialog.test.tsx tests/unit/ui/agent-hub/pty-session-recovery.test.ts`
  - `cargo test -p exomind-runtime resolve_workdir_path -- --nocapture`
  - `cargo test -p exomind-runtime --test pty_agent pty_spawn_and_interact -- --nocapture`
- 注意：
  - 在 Tauri dev app 持续运行时，`cargo test` 可能因为 `target/debug/exomind-rt.exe` 被占用而失败
  - Windows 下应优先考虑为额外 cargo 验证切独立 `CARGO_TARGET_DIR`

### 阶段补记：#806 用户故事实测闭环（2026-04-02 晚间）

#### 本轮阶段目标

- 用正在运行的 Tauri dev 实例，真实验证 #806 的两个核心终端用户故事，而不是只停留在单测：
  - Codex PTY 在 RT 重启后自动恢复并继续会话
  - 普通终端（CMD）在 RT 重启后不自动恢复，但历史 transcript 仍可回看，且断开态可手动“结束”收敛

#### 本轮观察结果

- 官方 `driver_session` 在当前环境仍会报 `Transport closed`，但 raw bridge `ws://127.0.0.1:9223` 可用。
- 当前 raw bridge 已确认稳定可用的命令：
  - `list_windows`
  - `execute_js`
- 可直接用 `execute_js` 调后端命令：
  - `window.__TAURI__.core.invoke('runtime_service_status')`
  - `window.__TAURI__.core.invoke('runtime_service_stop')`
  - `window.__TAURI__.core.invoke('runtime_service_start')`
- 可直接用页面上下文 `fetch('http://127.0.0.1:9124/...')` 验证 RT；不要把裸 `curl` 的 401 直接等同于“页面里也 401”。
- 普通终端 transcript 回放已在页面上下文直接验证成功：
  - `WebSocket('ws://127.0.0.1:9124/pty/<pty_id>/ws?mode=output')`
  - 对 `output` 帧做 base64 解码后，确认包含 marker：
  - `ISSUE806_CMD_1775147010819`
- 当需要验证“按钮到底有没有触发 React 逻辑”时，单靠 `button.click()` 不够稳定。
  - 更稳的做法：从 DOM 节点上找 `__reactProps$*`，直接调用 `onClick(...)`
  - 这能直接验证产品逻辑，而不是被浏览器事件层或 overlay 干扰

#### 本轮已验证的产品结论

- Codex PTY 用户故事已跑通：
  - RT stop 后，右栏进入断开只读态
  - RT start 后，自动恢复出新的 live PTY
  - 旧 Codex session 被归档，新 PTY 接管 fullscreen/tiled 持久化位置
- 普通终端（CMD）用户故事已跑通：
  - RT 重启后不会 auto-resume
  - transcript 可通过只读流回放
  - 断开态点击“结束”后，会话可从 `running` 收敛为 `completed`
- 本轮为此补上的代码修复点：
  - 右栏断开态 stop 在本地 session 缺失时，会回源 `/sessions` 再匹配并收敛
  - 增加了对应单测，覆盖“内存里没有 session，但 RT 里还有 session 记录”的真实场景

#### 本轮额外发现

- loopback 地址在当前 Tauri/RT 环境里不能只靠想当然处理，必须实测。
- 本轮现场曾观察到：
  - `fetch('http://localhost:9124/pty/:id/stop')` 与 `fetch('http://127.0.0.1:9124/pty/:id/stop')` 表现不一致
- 结论：
  - 遇到“按钮点了没反应”时，不要先断言是 UI 绑定问题
  - 先同时验证：
    - React `onClick` 是否真的触发
    - 实际发出的 URL 是什么
    - 同一端点在 `localhost` / `127.0.0.1` 下是否一致

#### 可复用操作套路

1. 先用 raw bridge 确认窗口与 RT 状态
   - `list_windows`
   - `execute_js(() => window.__TAURI__.core.invoke('runtime_service_status'))`
2. 需要验证 RT 数据时，优先在页面上下文里 `fetch`
   - `sessions`
   - `pty`
   - `topology`
3. 需要验证 transcript 是否真的可回放时，直接在页面里建 PTY output WebSocket
   - 收 `ready` / `output_reset` / `output` / `eof`
   - base64 解码后断言 marker
4. 需要验证按钮逻辑时，不要只依赖 DOM click
   - 先查 DOM 上的 `__reactProps$*`
   - 直接调用 `onClick`
   - 同时挂 fetch log，记录请求 URL / method / status
5. 做完一轮真实验证后，把：
   - 会话状态
   - localStorage 持久化键
   - fetch 轨迹
   - 关键 transcript marker
     一起保存到文档里，避免下轮重复排查

### 阶段补记：#818 终端 Agent 九条叙事全量通过（2026-04-04）

#### 本轮阶段目标

- 用真实桌面实例而不是 curl-only 验证 `#818`：
  - Claude Code / Codex 终端 Agent 可在「网络」页面创建、管理
  - UI 在拓扑图 / 会话 / 平铺 / 任务页之间来回切换时，PTY 加载稳定可重放
  - RT 重启后，Claude Code / Codex 会基于持久会话信息自动恢复
- 把这轮实测沉淀为可复用的 raw bridge 验收套路。

#### 本轮观察结果

- 当前稳定可用的桌面验收链路仍然是：
  - Tauri dev Web：`http://localhost:1420`
  - embedded RT：`127.0.0.1:9124`
  - raw bridge：`ws://127.0.0.1:9223`
- 直接跑：
  - `bun scripts/dev/tauri-mcp-issue806-charter.ts --name issue806-g --web-port 1420 --bridge-port 9223 --runtime-db .tmp/tauri-dev-state/issue806-g/app-data/runtime/sessions.sqlite`
- 本轮最新报告：
  - `.tmp/reports/tauri-mcp-issue806-charter/2026-04-04T16-28-55.048Z-issue806-g.md`
  - `.tmp/reports/tauri-mcp-issue806-charter/2026-04-04T16-28-55.048Z-issue806-g.json`
- 结果：
  - 九条终端用户叙事全部 `PASS`
  - RT 重启前后 UI/RT 活跃会话数一致
  - RT 重启后的两个活跃终端卡片都能重新加载并完成输入回显验证

#### 本轮收敛出的关键结论

- 右栏 PTY 终端“保持挂载”本身不是问题，真正危险的是：
  - 用户重复点击“当前已经打开的那张会话卡片”时，如果没有显式触发 reconnect/remount，控制台可能只有 `[agent-hub][pty][open]`，却没有新的 `[PtyTerminal] opening/connected`。
- 因此，终端卡片/拓扑节点的用户主动 reopen 路径必须支持：
  - 同 PTY 条件下强制重连
  - 让「再次点击同一活跃会话」也成为一次可重放的 PTY 加载动作
- `spawn` 路径不能把原始 `ptyId` 直接写进 `paneOrder`：
  - `paneOrder` 的语义是 session id，不是 PTY id
  - 对新 spawn 的 PTY，应该先等待 session 流补齐，再把它映射回真正的 session id
- 对没有 session 绑定的 raw PTY：
  - 打开时要清空旧的 fullscreen recovery snapshot
  - 否则 RT 重启后可能被陈旧恢复信息误导

#### 本轮可复用操作套路

1. 先用 charter 脚本跑完整九条叙事，不要只手点 1-2 条路径。
2. 如果报告里出现：
   - `loadingObserved: false`
   - 只有 `[agent-hub][pty][open]`
   - 没有 `[PtyTerminal] opening/connected`
     优先怀疑“点到了当前 active PTY，但没有触发真正的 reconnect/remount”。
3. 如果 spawn 后平铺顺序异常，先检查 localStorage：
   - `exomind:agentHubTiledState.paneOrder` 是否混入了 `ptyId`
4. 如果 RT 重启后恢复错位，先检查 localStorage：
   - `fullscreenTerminalRecovery` 是否还是陈旧 snapshot
5. 每次跑完桌面验收，都把：
   - charter 命令
   - report 路径
   - 通过/失败结论
     一并写回 PR / issue / playbook，避免下轮重复试错

### 阶段补记：RT 重启后的重复 session / 归档残留（2026-04-02 深夜）

#### 现象

- 在 Tauri dev 实例里，普通终端经过：
  - spawn
  - RT stop/start
  - disconnected stop
  - archive
- 后端 `/sessions` 已返回 `status: "archived"`，但 SessionsView 里卡片仍可能残留。
- 同时页面里会出现：
  - 同一个 `session.id` 对应多张卡片
  - 同一个 Codex/PTy 卡片在活跃区或已完成区重复出现

#### 根因

- `useSessionStream` 之前按 `source_host_id + session.id` 聚合。
- RT 重启后，host identity 会漂移；同一个 runtime session 会被来自不同 target 的拉取/SSE 装饰成多条前端记录。
- 结果是：
  - 同一个 `session.id` 被渲染多次
  - 后续 `session.updated` 只命中新 target 对应的那一条
  - 旧 target 对应的旧状态卡片留在 UI 里，形成“接口已 archived，但卡片不消失”的假象

#### 本轮修复策略

- `useSessionStream` 改为按 `session.id` 去重/upsert：
  - initial fetch 聚合后去重
  - `session.created` 走去重插入
  - `session.updated` 走按 `session.id` 覆盖
  - `session.deleted` 直接按 `session.id` 删除
- `handleArchiveSession()` 在 `PATCH /sessions/:id` 成功后主动 `refreshSessions()`：
  - 不再把“卡片消失”完全押注在 SSE 自动同步上
  - 对 RT 重启后的现场更稳

#### 实测验证点

- 重新加载当前 Tauri 页面后，再跑：
  - spawn 普通 CMD
  - 打开右栏
  - RT stop/start
  - 断开态 stop
  - SessionCard archive
- 最终确认：
  - RT `/sessions` 中该 session 为 `archived`
  - `session-card-<id>` 不再出现在 SessionsView
  - `session-card-archive-<id>` 也随之消失

#### 新增调试经验

- 在 Tauri dev + Vite HMR 场景里，代码改完后不要默认当前页面已经吃到最新逻辑。
- 如果现场结果与单测不一致，优先做一次：
  - `window.location.reload()`
  - 然后再重新进入 `Sessions` 视图复测
- 判断“卡片没消失”时，至少同时看三层：
  - RT `/sessions` 的真实状态

### 阶段补记：#532 双 embedded RT 跨档案同步章程（2026-04-06）

#### 本轮阶段目标

- 用两个真实 Tauri 桌面实例，而不是单 RT / 单窗口 / curl-only 假验收，验证同一档案 scope 下四个域都能跨 embedded RT 增量同步：
  - EventLog
  - Task
  - TimeBlock
  - Proposal
- 把“档案对齐 -> pairing -> peer online -> 四域真实写入 -> 对端真实可见 -> 基线回收”为一条可复跑章程。
- 明确区分：
  - mesh / peer 看起来在线
  - 真实业务对象已经落到对端 store

#### 本轮观察结果

- 当前更稳的拓扑不是只靠一个窗口，而是：
  - `tauri:manager` 管双实例
  - raw bridge 负责拿窗口真值、执行 pairing、读取 `runtime_service_status`
  - 已知 `rtBaseUrl` 后，基线/终态快照直接打 RT HTTP 路由
- 双实例如果并行启动，第二个实例可能错误继承第一个实例的 RT 端口；本轮现场就出现过两个 wrapper 都解析到同一 RT 端口的情况。
- `tauri:manager list` 把实例标成 `stale`，不等于实例真的死了；但如果同时满足：
  - 没有对应 `exomind.exe`
  - raw bridge 不可连
  - 目标 RT 端口不通
    就不能继续把它当成可用实例。
- 只看 pairing / peer online 会误判问题已经解决；这轮首次新版章程跑出的失败就是：
  - 四域主对象部分可同步
  - 但 Task / TimeBlock 内部动作写出来的 EventLog 副产物没有跨 RT replication
  - 导致最终 scope snapshot 的 `eventlogCount` 两端不一致
- 页面里 `execute_js(fetch(...))` 适合拿窗口真值，但不适合承载所有长链路读数；终态 snapshot 阶段偶发脚本超时时，直接打 RT HTTP 更稳。

#### 本轮结论

- 对跨 RT 同步，当前稳定判定标准应是：
  1. manager 能定位到两个真实实例
  2. 两边 raw bridge 可连
  3. 两边 `runtime_service_status` 明确返回 `externalRuntime=false`
  4. 双边 peer 都进入 `status=online`
  5. 四域动作都能在对端对应路由看到真实对象
  6. 清理后 final snapshot 两端重新对齐
- 本轮补齐后，真实缺口已经从“peer online 但业务对象没落库”推进到“Task / TimeBlock 副产物 EventLog 也能跨 RT 对齐”。
- Proposal 域现在也已经进入“可作为跨 RT 共享对象验收”的阶段，不再只是单端 MVP。

#### 本轮可复用操作套路

1. 启动双实例时优先顺序启动；第二实例显式指定 RT 端口，避免端口误抢。
2. 先从 raw bridge 拿每个窗口的：
   - `runtime_service_status`
   - 当前 `rtBaseUrl`
   - 页面标题 / route / 实例名
3. 配对时不要只做发现；要显式完成：
   - pairing
   - 双边 peer upsert
   - interests 写入
   - 等待两边 `mesh/peers.status === online`
4. 做验收时不要只看 signal；每个域都必须执行真实业务动作，再轮询对端真实路由直到对象可见或超时。
5. 基线与终态统一直接打 RT HTTP：
   - `/eventlog`
   - `/tasks`
   - `/timeblocks`
   - `/api/proposals`
6. 若报告失败，优先比对 baseline / final snapshot，而不是先看控制台噪音；它更容易暴露“主对象同步了，但副产物没对齐”的真实缺口。
7. 每轮结束都保存 JSON + Markdown 报告，并把：
   - 实例拓扑
   - 端口真值
   - pairing 结果
   - 分域延迟
   - final snapshot
     一起回写 issue / playbook，避免下轮重复取证。

#### 本轮踩坑记录

- `tauri:manager` 的元数据不能替代运行真值；manager、bridge、RT 端口三者必须交叉验证。
- 并行启动双实例时，端口继承错误比“实例没起来”更隐蔽，因为窗口表面上仍可打开。
- 当前长尾延迟主要出现在：
  - task create
  - timeblock start
  - proposal transition
    结论不是“同步错误”，而是“当前仍有明显延迟尾部，后续应继续压缩”。
- 文档里出现的实例名、端口、报告路径都只是现场样例；下一轮复跑必须先取当前真值，不要机械复用。

### 阶段补记：#806 章程在真窗实例中完整跑通（2026-04-04）

#### 阶段目标

- 把 `#806` 及其衍生用户故事，收敛成可重复执行的 Tauri MCP 自动交互章程。
- 在当前唯一存活实例 `UI 1420 / RT 9124 / bridge 9223` 上，真实验证 Claude Code / Codex 两类终端 Agent 的创建、管理、页面切换、RT 重启后恢复。
- 确认“会话页 / 请求箱页卡死、无日志、活跃卡点击无响应”的旧坏态已经消失。

#### 观察结果

- 官方 `mcp__tauri_mcp_server__driver_session` 仍返回：
  - `Transport closed`
- 但同一 Tauri 实例暴露的 raw bridge 仍可稳定连接：
  - `ws://127.0.0.1:9223`
- 通过 `scripts/dev/tauri-mcp-issue806-charter.ts` 在 direct mode 真窗实跑，得到：
  - `overallPass: true`
  - `activeCount: 2`
  - `mismatchCount: 0`
- 本轮实跑使用参数：
  - `--name web-1420`
  - `--web-port 1420`
  - `--bridge-port 9223`
  - `--runtime-db .tmp/tauri-dev-state/web-1420/app-data/runtime/sessions.sqlite`
- 真窗章程报告确认：
  - 重启前 UI/RT 会话统计一致：`2/11/13`
  - 请求箱页可加载，不再停留在“请求箱加载中...”
  - 两张活跃卡点击后，右侧 `Terminal` 面板都能正常显示终端
  - 已完成卡点击后，右侧进入只读断开历史态，并显示失败/历史文案
  - 控制台能看到 `[agent-hub][pty][open]` 相关 trace
  - RT 重启后 hostId 完成切换：
    - `rt-58676cb3-ad7f-41e6-af70-b0b0e9406ec1`
    - `rt-9c8b50ba-5192-4b17-bdef-6f3c795d063c`
  - RT 重启后 UI/RT 会话统计仍一致：`2/11/13`
  - RT 重启后 `/pty` 数量恢复到 `2`
  - RT 重启后两张新的活跃卡仍都能打开右侧 Terminal

#### 结论

- `#806` 当前阶段的终端 Agent 主叙事已在真实桌面实例中跑通：
  - 可以在“网络”页管理 Claude Code / Codex 终端 Agent
  - 页面在 `/agents` 与 `/proposals` 之间切换，不会把活跃会话误伤成断开或 completed
  - embedded RT 重启后，UI 能重新收敛到新的 runtime hostId，并恢复 Claude/Codex 的活跃终端会话
  - 对不可恢复或已结束的会话，右侧面板不再卡死，而是进入只读历史/失败态，并带控制台可追溯日志
- 这次真正收住的关键边界有三类：
  - fresh session grace：新建 PTY 在 `/pty` 列表尚未追平前，不会被误判死亡
  - stale local host fallback：旧 `source_host_id` 仍残留时，允许回退到当前 embedded runtime 判定与恢复
  - stale loopback snapshot hostId correction：RT 重启后若 runtime snapshot 仍残着旧 `127.0.0.1:9124` host 记录，前端不再盲信旧 hostId，而是优先信 live runtime hostId

#### 可复用操作套路

1. 先判定官方 Tauri MCP 是否可用
   - 若 `driver_session` 返回 `Transport closed`，不要继续在官方 MCP RPC 上空转
2. 改走同实例 raw bridge
   - 默认检查 `ws://127.0.0.1:9223`
   - 当前 `web-1420` 的 raw bridge 即为 `9223`
3. 真窗验证优先用章程脚本，而不是散乱手点
   - `bun scripts/dev/tauri-mcp-issue806-charter.ts --name web-1420 --web-port 1420 --bridge-port 9223 --runtime-db .tmp/tauri-dev-state/web-1420/app-data/runtime/sessions.sqlite`
4. 章程里必须同时覆盖三段
   - 重启前 session 统计一致
   - `/proposals` 往返后仍一致
   - `runtime_service_stop/start` 后 hostId 切换、`/pty` 回补、活跃卡可再打开 Terminal
5. 遇到“RT 重启后 UI 卡死但无日志”时，最先看四个点
   - `runtime_service_status.hostId` 是否已经变化
   - 页面上下文 `fetch('/sessions')` 与 `fetch('/pty')` 是否一致
   - 当前活跃卡的 `source_host_id` 是否仍指向旧 host
   - `resolvePtySpawnConnectionTarget()` 是否被旧 loopback snapshot hostId 误导

### 阶段补记：#806 / #824 自动章程落地（2026-04-03）

#### 本轮阶段目标

- 把 `#806`、`#822`、`#824`、`#828` 的关键用户故事，收敛为一个可直接执行的 Tauri MCP 自动章程。
- 让章程不只依赖 UI DOM，还能同时核对：
  - 当前 `tauri:manager` 实例
  - raw bridge
  - RT SQLite 真值
  - webview console trace

#### 本轮观察结果

- 当前 Windows 现场里，官方 `driver_session` 仍可能返回 `Transport closed`。
- 但 raw bridge 在当前 `tauri:manager` 实例上稳定可用，可以持续执行：
  - `list_windows`
  - `execute_js`
- 当前实例 `issue806-g` 上：
  - 会话页 UI 汇总为 `active=0 completed=1 total=1`
  - RT `sessions.sqlite` 真值同样为 `0/1/1`
  - 点击已完成 session card 后：
    - 右侧进入断开历史视图
    - UI 明确显示失败消息
    - console 出现 `[agent-hub][pty][open] ...` trace
  - `/proposals` 可进入请求箱页面，不再卡在 `请求箱加载中...`

#### 本轮结论

- “Tauri MCP 章程”在当前阶段应分成两层：
  - 实例与桥接层：`tauri:manager` + raw bridge
  - 产品断言层：UI DOM + SQLite + console trace
- 对 `#824` 而言，只看 `/sessions` HTTP 已不够，因为当前现场可能受认证与宿主态影响；SQLite 真值对账更稳。
- 对 `#822` 而言，不能只看 UI 提示，还要直接抓到 webview console trace。

#### 可复用操作套路

1. 先跑：
   - `bun run tauri:manager list`
2. 再跑：
   - `bun run tauri:charter:issue806 -- --name <instance>`
3. 如果章程失败，按以下顺序拆解：
   - raw bridge 是否连通
   - `/agents` 会话页是否可渲染
   - UI 与 `sessions.sqlite` 是否一致
   - session card 点击后是否有断开/实时态反馈
   - console 是否出现 `[agent-hub][pty][open]`
   - `/proposals` 是否停在 loading
4. 若官方 MCP transport 恢复，再考虑把同一套断言迁回 `driver_session` 封装层；当前先不要阻塞在 transport 问题上

### 阶段补记：#812 局域网免 Token 与本机 curl（2026-04-03）

#### 本轮修复前的误区

- 之前在 `lan + allowLanWithoutAuth=true` 的 embedded RT 上，裸跑：
  - `curl http://127.0.0.1:9124/sessions`
  - `curl http://127.0.0.1:9124/pty`
- 仍会返回 `401`。
- 一度容易误判成：
  - RT 没启动
  - token 没同步
  - WebView/前端与 curl 访问的是两套不同服务

#### 真实根因

- `crates/exomind-runtime/src/auth.rs` 之前把“局域网免 Token”只作用于 `私网非 loopback` 请求。
- `127.0.0.1` / `::1` 被排除在该分支之外，只能走：
  - `loopback + trusted Origin`
- 所以：
  - 浏览器/WebView 请求如果带可信 `Origin`，可通过
  - 直接 `curl` / Postman / 地址栏访问本机 loopback，因为没有可信 `Origin`，仍会 `401`

#### 修复后的正确心智

- 当用户显式开启 `allowLanWithoutAuth=true` 时：
  - `127.0.0.1`
  - `::1`
  - `192.168.x.x`
  - `10.x.x.x`
  - 其他私网/link-local
    都应直接绕过 token，不再要求 `Origin`
- trusted loopback origin 这条旧路径仍保留，只是不再是开启 LAN 免 token 后访问本机 RT 的唯一通道

#### 本轮现场验证

- Rust 定向测试：
  - `cargo test -p exomind-runtime --test auth_middleware -- --nocapture`
  - 新增断言：
    - loopback + 无 Origin + 无 token，在 `allow_lan_without_auth=true` 时返回 `200`
    - loopback + 恶意 Origin + 无 token，在 `allow_lan_without_auth=true` 时也返回 `200`
- 当前运行中的 Tauri dev 实例也已热更新验证通过：
  - `curl http://127.0.0.1:9124/topology` -> `200`
  - `curl http://127.0.0.1:9124/sessions` -> `200`
  - `curl http://127.0.0.1:9124/pty` -> `200`
  - `curl "http://127.0.0.1:9124/pty/sessions?agent_type=claude"` -> `200`

#### 对后续 #806 验收的直接价值

- 之后做 Codex / Claude / CMD 的 PTY 生命周期验收时：
  - 本机 `curl` 已经可以直接访问 embedded RT
  - 不需要再伪造 `Origin: http://localhost:1420`
  - 也更容易把“鉴权问题”和“会话恢复问题”分开排查
  - 当前页面 DOM 中是否还有 `session-card-*`
  - 当前页面是否把同一个 `session.id` 渲染成了多条卡片

### 阶段补记：MCP_OK 终验（2026-04-03）

#### 终验动作

- 对运行中的 Tauri dev 实例执行一次 `window.location.reload()`，确保页面吃到最新前端逻辑。
- 切回 `Sessions` 视图后，重新跑最小真实链路：
  - spawn 普通 CMD
  - 打开右栏
  - `runtime_service_stop`
  - `runtime_service_start`
  - 断开态 `结束`
  - SessionCard `×` 归档

#### 终验结论

- 最终实测结果：
  - `sessionId = 9a1b884c-d0b4-471b-bb6e-fe65599a416c`
  - RT `/sessions` 返回该 session `status: "archived"`
  - `session-card-9a1b884c-d0b4-471b-bb6e-fe65599a416c` 不在 DOM 中
  - `session-card-archive-9a1b884c-d0b4-471b-bb6e-fe65599a416c` 也不在 DOM 中
- 这说明：
  - 普通终端在 RT 重启后的“结束 -> completed -> 归档 -> 从列表消失”闭环已在真实 Tauri 窗口中跑通
  - `useSessionStream` 去重 + `handleArchiveSession().refreshSessions()` 的组合修复已在现场生效

### 阶段补记：#816 Claude Windows spawn 修复终验（2026-04-03）

#### 本轮阶段目标

- 把“Windows 下 Claude 终端 Agent 无法启动，CreateProcessW 命中无效 shim 报 os error 193”拆到 `#816`，并在真实 Tauri 窗口中验证修复生效。
- 验证标准不是单测，而是桌面 UI 内真实完成一次 Claude Terminal 创建。

#### 根因结论

- Windows 现场 `where claude` 同时命中：
  - `C:\\Users\\56506\\AppData\\Roaming\\npm\\claude`
  - `C:\\Users\\56506\\AppData\\Roaming\\npm\\claude.cmd`
- PTY 之前只把 `codex` 收敛到 `codex.cmd`，没有对 `claude` 做同类处理。
- `portable_pty` 直接拿裸 `claude` 去 `CreateProcessW` 时，会把 npm shim 当成可执行文件处理，最终报：
  - `%1 不是有效的 Win32 应用程序。 (os error 193)`

#### 本轮代码修复

- RT `resolve_spawn_command()` 在 Windows 下新增：
  - `claude -> claude.cmd`
  - `codex -> codex.cmd` 继续保留
- 补了对应 Rust 单测：
  - `resolve_spawn_command_uses_windows_cli_shims_for_builtin_agents`
  - `resolve_spawn_command_keeps_custom_commands_unchanged`

#### 本轮真实窗口验证

- 官方 `driver_session` 仍报 `Transport closed`，本轮继续使用 MCP bridge raw WebSocket：
  - `ws://127.0.0.1:9223`
- 当前真实窗口：
  - `ExoMind [feature/issue-806-terminal-lifecycle] [Web:1420 RT:9124]`
  - URL `http://localhost:1420/agents`
- 在窗口内直接验证：
  - `runtime_service_status` 返回 `running: true`
  - 页面内 `fetch('http://127.0.0.1:9124/pty')` 返回 `200`
- 真实 UI 创建 Claude Terminal 的关键证据：
  - `GET http://localhost:9124/pty/sessions?agent_type=claude` -> `200`
  - `POST http://localhost:9124/pty/spawn` -> `201`
  - 返回：
    - `id: "0ee5936b-0f2c-4df6-a0c1-18dd85de56fe"`
    - `name: "claude-0ee5936b"`
    - `command: "claude"`
    - `workdir: "H:\\A137442\\Develop\\AGI\\exomind\\"`
- 创建完成后页面状态：
  - `localStorage['exomind:agentHubTiledState'].fullscreenPtyId`
    - `0ee5936b-0f2c-4df6-a0c1-18dd85de56fe`
  - `agent-rightpanel-pty-terminal` 可见
  - `.xterm` 数量为 `1`
  - 启动弹窗已关闭

#### 本轮额外经验

- raw bridge 下，普通 DOM `click()` 不一定能稳定触发 React 逻辑。
- 更稳的办法：
  - 先从 DOM 节点读取 `__reactProps$*`
  - 直接调用对应 `onClick(...)`
- 但提交按钮场景里，最终更接近真实用户的做法仍更稳：
  - 用 React props 打开弹窗
  - 等弹窗真正挂载后，再对可见按钮执行原生 `click()`
- 验证是否真的创建成功时，不要只看 UI：
  - 同时抓页面内 fetch 轨迹
  - 再看 `localStorage` 的 `fullscreenPtyId`
  - 再看右栏 `.xterm` 是否已挂载

### 阶段补记：#806 Claude/CMD 恢复链路终验（2026-04-03）

#### 本轮阶段目标

- 用正在运行的 Tauri dev 实例，把 #806 的两条核心终端用户故事在真实桌面窗口里跑通：
  - Claude/Codex Terminal 在 RT stop/start 后，能够自动恢复并继续原对话
  - 普通终端（CMD）在 RT stop/start 后不自动恢复，但关闭前 transcript 仍可查看
- 同时沉淀一套 raw bridge + 页面内 `fetch` / PTY WebSocket 的最小可复用验收套路

#### 本轮关键实现结论

- `PtySpawnDialog` 不再只给 Codex 补 `inner_session_id`
  - Claude / Codex 都会在 spawn 后轮询 `/pty/sessions?agent_type=...`
  - 命中唯一且工作目录匹配的历史 session 后，回写 `PATCH /sessions/:id`
- Claude 的历史 session 目录比对不能照抄 Codex：
  - Codex 用绝对路径比较
  - Claude 用编码后的 `project_path` 比较，例如：
  - `H:/A137442/Develop/AGI/exomind` -> `H--A137442-Develop-AGI-exomind`
- 自动恢复前必须再次校验当前 `inner_session_id` 仍属于同一工作目录
  - 不能只因为 session id 存在就直接 `POST /pty/resume`
  - 否则断线后可能把旧 PTY 串到错误的历史会话
- `AgentsPage` 需要额外的 in-flight 锁
  - 否则 RT 刚恢复可达时，自动恢复逻辑可能并发双发 `/pty/resume`

#### 本轮真实窗口验证

- 当前桌面实例：
  - 窗口标题 `ExoMind [feature/issue-806-terminal-lifecycle] [Web:1420 RT:9124]`
  - raw bridge `ws://127.0.0.1:9223` 可用
- Claude 创建后，首次真实交互前不一定立刻出现在 `/pty/sessions?agent_type=claude`
  - 至少发起一次真实对话后，历史 session 才会稳定出现
- 向 PTY 发输入时，页面内输入帧必须是：
  - `{"type":"input","input_seq":<n>,"data":"<base64>"}`
  - 通过 `mode=input` 的 PTY WebSocket 发送
  - 不是 `{ "input": "..." }`
- Claude 历史 session 补绑已在现场验证通过：
  - 创建 Claude PTY
  - 发送一次真实对话
  - `/sessions` 中对应 unified session 自动出现 `inner_session_id`
- Claude 自动恢复已在现场验证通过：
  - `runtime_service_stop`
  - `runtime_service_start`
  - 旧 unified session 被归档
  - 新 PTY 自动接管右栏/持久化位置
  - 再次发问时，Claude 能回答 stop 前的旧上下文，不是新空会话
- CMD 用户故事也已在现场验证通过：
  - spawn 普通 `cmd`
  - 执行 marker 命令并确认输出
  - stop/start RT 后不会自动 resume 出新 PTY
  - 右栏断开态仍能显示关闭前 transcript

#### 现场验证的最低成本套路

1. 用 raw bridge 执行 `window.__TAURI__.core.invoke('runtime_service_status')`
2. 在页面上下文里直接 `fetch('http://127.0.0.1:9124/sessions')` / `fetch('/pty')`
3. 需要验证 transcript 时，直接在页面里建 `WebSocket('/pty/:id/ws?mode=output')`
4. 收到 `output` 帧后做 base64 解码，再断言 marker 文本
5. 需要确认按钮逻辑是否真正命中 React 时，优先取 DOM 上的 `__reactProps$*` 并直接调 `onClick(...)`

#### 对后续 Agent 的直接提醒

- 不要假设 Claude spawn 后立刻就能从 `/pty/sessions?agent_type=claude` 查到历史 session
- 不要把 `button.click()` 是否生效，直接等同于“产品逻辑是否正确触发”
- 不要在断线恢复场景里只看 UI；至少同时看：
  - `/sessions`
  - `/pty`
  - `localStorage['exomind:agentHubTiledState']`
  - PTY output WebSocket 的 transcript 内容

### 阶段补记：#806 新 PTY 误判 disconnected 竞态修复（2026-04-03）

#### 现象

- 新建 Terminal 后，右栏会先闪成：
  - `agent-rightpanel-pty-disconnected`
- 但同一时刻 RT 里的 PTY 实际已经创建成功，属于前端误判，不是真断线。

#### 根因

- `AgentsPage` 之前在 `openPtyTerminal()` 后立即用：
  - `knownPtyIds`
  - `hasLoadedPtyAgents`
- 来判断当前 PTY 是否存在。
- 对“刚 spawn / 刚 resume 出来的新 PTY”来说：
  - 右栏已经切到新 `ptyId`
  - 但 `/pty` 列表还没刷新到包含它
- 于是页面会把“新 PTY 还没进列表”误判成“PTY 已不存在”。

#### 本轮修复策略

- 只对“新 PTY”加一层待确认保护，而不是对所有 `openPtyTerminal()` 一刀切：
  - `spawn` 成功后打开的新 PTY
  - `resume` 成功后打开的新 PTY
- 这些 PTY 会先进入 `pendingPtyPresenceChecks`
- 在同 host 的第一次成功 `/pty` 拉取完成前：
  - 不把它判为 disconnected
- 一旦这次新的 `/pty` 拉取成功：
  - 如果列表里有该 PTY，正常转 live
  - 如果列表里仍没有该 PTY，再允许进入 disconnected
- 旧的 stale session 仍保持原语义：
  - 用户点开一个早就不在 `/pty` 列表里的会话时，应该立刻看到 disconnected
  - 不应被这层保护误伤

#### 本轮验证

- 单测：
  - `bunx vitest run tests/unit/ui/agent-hub/agents-page.issue806.test.tsx tests/unit/ui/agent-hub/agents-page.session-actions.issue523.test.tsx tests/unit/ui/agent-hub/pty-spawn-dialog.test.tsx tests/unit/ui/agent-hub/pty-session-recovery.test.ts`
  - `bunx tsc --noEmit`
- 新增回归点：
  - `keeps a newly opened PTY live until a fresh PTY list confirms it is missing`
- 同时复核旧语义未回归：
  - stale session 打开后仍会进入 disconnected
  - session stop / archive / recovery 相关测试全部通过

#### Tauri 实窗验收

- 继续使用 raw bridge：
  - `ws://127.0.0.1:9223`
- 先对主窗口执行一次 `window.location.reload()`
- 再在真实窗口内：
  - 打开 `Terminal` 弹窗
  - 切到 `custom`
  - 输入 `cmd`
  - 点击“启动新会话”
- 现场结果：
  - `terminalVisible = true`
  - `disconnected = false`
  - `.xterm` 数量 = `1`
  - `fullscreenPtyId = b4a55470-452f-466e-8a14-924fca0844fc`
- 随后用 RT HTTP 清理：
  - `POST /pty/b4a55470-452f-466e-8a14-924fca0844fc/stop` -> `200`
  - `PATCH /sessions/b4a55470-452f-466e-8a14-924fca0844fc` `{ "status": "archived" }` -> `200`

#### 对后续 Agent 的提醒

- “新 PTY 打开后短时间不判死”是有边界的：
  - 只适用于新 spawn / 新 resume 的 PTY
  - 不适用于用户点开一个早就 stale 的旧 session
- 如果后续又看到“右栏一打开就 disconnected”，先区分两类场景：
  - 这是刚创建的新 PTY，还是旧 session 的回看？
  - `/pty` 是否已经完成过一次新的成功拉取？

### 阶段补记：#817 唯一历史窗口占用与双恢复压制（2026-04-03 中午）

#### 本轮阶段目标

- 补上“窗口切换前后一致”这一口：
  - 同一条 Claude / Codex 历史 `inner_session_id` 在当前 RT 中只能占一个打开中的 PTY 窗口
  - 历史恢复弹窗中已被占用的会话要禁用，并明确显示“已打开窗口”
  - 点击旧的重复 session 卡片时，要转向已有 PTY，而不是再发一次 `/pty/resume`
- 继续用当前 Tauri dev 实例 + raw bridge 做真窗验证，而不是只停留在单测

#### 本轮代码结论

- `PtySpawnDialog` 现在支持传入：
  - `occupiedHistoricalSessionIds`
  - `occupiedHistoricalSessionLabels`
- 历史会话条目若已被当前 RT 内的活动终端会话占用：
  - 按钮会禁用
  - 右侧显示：
  - `已打开窗口 · <当前窗口名>`
- `AgentsPage` 会按：
  - `activePtyId`
  - 当前 live `/pty`
  - `tiledPaneOrder`
  - `last_active_at`
    来挑选某个 `inner_session_id` 的 canonical session
- 当用户点击一个旧的重复 session 卡片，或 auto-resume 命中重复历史会话时：
  - 不再发第二次 `/pty/resume`
  - 直接切到 canonical PTY
  - 被 supersede 的旧 unified session 会收敛为 `completed -> archived`

#### 本轮单测结果

- `bunx vitest run tests/unit/ui/agent-hub/pty-spawn-dialog.test.tsx tests/unit/ui/agent-hub/agents-page.issue806.test.tsx`
- `bunx vitest run tests/unit/ui/agent-hub/agents-page.issue806.test.tsx tests/unit/ui/agent-hub/agents-page.session-actions.issue523.test.tsx tests/unit/ui/agent-hub/pty-spawn-dialog.test.tsx tests/unit/ui/agent-hub/pty-session-recovery.test.ts`
- `bunx tsc --noEmit`

#### 本轮真窗验证 1：历史会话占用态

- 继续使用 raw bridge：
  - `ws://127.0.0.1:9223`
- 刷新页面后，打开 `Terminal` 弹窗并切到 `codex`
- 页面内直接读取当前 `/sessions`，找到一个已打开中的 Codex 历史会话：
  - `inner_session_id = 019d50e4-7668-70f2-831c-4402b903d9d7`
- 现场结果：
  - 历史条目存在
  - 按钮 `disabled = true`
  - 提示文本：
  - `已打开窗口 · issue806-direct-codex-1775179150584`

#### 本轮真窗验证 2：点击旧重复卡片不再开第二扇窗

- 在 `Sessions` 视图中，定位同一个 `inner_session_id = 019d50e4-7668-70f2-831c-4402b903d9d7` 下的一张旧卡片：
  - `clickedSessionId = abf9d818-3c00-4931-b374-f4b5c22879c7`
- 点击该旧卡片后，现场结果：
  - `resumeCallCount = 0`
  - `clickedSessionStatusAfter = archived`
  - `fullscreenPtyId = 48e1365a-dcdd-4bb8-be1b-b6807ac60132`
- 这说明：
  - 页面没有再发第二次 `/pty/resume`
  - 旧卡片被自动收敛归档
  - 右栏直接切到了已有 canonical PTY

#### 本轮真窗验证 3：Codex stop/start 后按历史 session 自动恢复

- 以当前激活中的 Codex session 作为目标：
  - `targetSessionId = 48e1365a-dcdd-4bb8-be1b-b6807ac60132`
  - `targetInnerSessionId = 019d50e4-7668-70f2-831c-4402b903d9d7`
- 通过页面内：
  - `window.__TAURI__.core.invoke('runtime_service_stop')`
  - `window.__TAURI__.core.invoke('runtime_service_start')`
    做 RT stop/start
- 现场结果：
  - `fullscreenPtyIdBefore = 48e1365a-dcdd-4bb8-be1b-b6807ac60132`
  - `fullscreenPtyIdAfter = 4ebd609b-5103-42d4-b56d-b8cfdf5dfc79`
  - `recoveredSessionId = 4ebd609b-5103-42d4-b56d-b8cfdf5dfc79`
  - `recoveredSessionStatus = running`
  - `oldSessionStatusAfter = completed`
- 结论：
  - Codex 在 RT 重启后已能基于同一历史 `inner_session_id` 自动恢复
  - fullscreen/tiled 持久化位置会切到新的 live PTY

#### 本轮真窗验证 4：Claude stop/start 后按历史 session 自动恢复

- 以当前激活中的 Claude session 作为目标：
  - `targetSessionId = fbf798c9-6b86-46b1-8ee9-971b46be3b01`
  - `targetInnerSessionId = 93237b7d-8153-4d9b-ab27-049ecf285df9`
- 先切到该 Claude session，再 stop/start RT
- 现场结果：
  - `fullscreenPtyIdBefore = fbf798c9-6b86-46b1-8ee9-971b46be3b01`
  - `fullscreenPtyIdAfter = 2cd3799c-e0c5-4f38-a68b-a09d6afcfe23`
  - `recoveredSessionId = 2cd3799c-e0c5-4f38-a68b-a09d6afcfe23`
  - `recoveredSessionStatus = running`
  - `oldSessionStatusAfter = archived`
- 结论：
  - Claude 这条自动恢复链路在当前桌面窗口中也已打通
  - 不再只是 Codex 特例

#### 对后续 Agent 的提醒

- 如果现场已经存在“多个 running session 共享同一个 `inner_session_id`”，不要先急着手动清库。
  - 先点击旧卡片或触发一次恢复路径
  - 看它是否会自动把旧 session 收敛成 `archived`
- 验证“没有再开第二扇窗”时，不要只看 DOM。
  - 同时记录：
  - `resumeCallCount`
  - `fullscreenPtyId`
  - 被点击旧 session 的最终 `status`
- 在 raw bridge 下做 stop/start 验收时，长脚本容易触发 `execute_js` 超时。
  - 更稳的做法是拆成三步：
  - 先锁定目标 session 并写入 localStorage 临时键
  - 再单独 stop/start RT
  - 最后再单独轮询 `/sessions` 验证恢复结果

### 阶段补记：#806 stop/归档请求地址漂移与反馈补齐（2026-04-03 下午）

#### 阶段目标

- 复现并修复“网络/会话”页里点击 `停止/结束` 像没反应的问题。
- 确认 stop 链路不再错误打到 `http://localhost:9124/...`，并让断开态会话能在 UI 内完成：
  - `stop -> completed -> archive`

#### 观察结果

- 当前 Tauri MCP 官方 `driver_session` 可直接使用，`main` 窗口 URL 为：
  - `http://localhost:1420/agents`
- 在 WebView 里包一层 `window.fetch` 追踪后，现场明确观察到旧问题：
  - 相同 stop 请求若走 `http://localhost:9124/...`，会挂住直到前端超时
  - 同一路径改成 `http://127.0.0.1:9124/...`，会在几十毫秒内返回真实 `404`
- 修复后再次在真实窗口复测：
  - 右栏断开态点击 `结束`
  - 实际请求：
    - `POST http://127.0.0.1:9124/pty/<id>/stop` -> `404`
    - `PATCH http://127.0.0.1:9124/sessions/<id>` -> `200`
  - 页面出现 toast：
    - `已收敛失联 Terminal 会话`
  - `console` 出现结构化日志：
    - `[agent-hub][pty][stop] start`
    - `[agent-hub][pty][stop] reconciled missing PTY session`
- 随后切到 `Sessions` 视图，现场确认：
  - 该会话进入 `已完成`
  - 出现 `归档` 按钮
  - 再点归档后，卡片从列表消失，`会话` 总数与 `已完成` 计数同步减少

#### 结论

- 这次“按钮点了个寂寞”的主因不是 stop 后端慢，而是：
  - 前端链路在某些 host 上下文里用了会挂住的 `localhost`
- 修复策略应同时包含三层：
  - 地址归一化：`localhost -> 127.0.0.1`
  - 行为反馈：toast + inline error banner + console trace
  - 失联收敛：stop 返回 `404/timeout/network` 时，先复核 live `/pty`，再把会话收敛为 `completed`
- 实窗结果证明：
  - stop 不再静默失败
  - 异常 PTY 现在可以从 UI 内真正结束并归档

#### 可复用操作套路

1. 用 `webview_execute_js` 包装 `window.fetch`
   - 记录 `url / method / status / elapsedMs`
   - 先看真实请求是不是打到了错误的 host
2. 用 `webview_dom_snapshot` 拿 accessibility tree
   - 找右栏断开态按钮
   - 直接用 `ref=e...` 精确点击，不要靠猜坐标
3. 点击按钮后同时查三层证据：
   - toast 文本
   - `window.__ptyFetchLog`
   - `read_logs source=console filter=agent-hub`
4. 验证“可归档”不要停在 stop 成功
   - 还要切到 `Sessions`
   - 确认进入 `已完成`
   - 再点一次 `归档`
   - 最后确认卡片从 DOM 中消失

### 阶段补记：#824 会话卡片打开反馈闭环与 superseded PTY 清理补丁（2026-04-03 晚）

#### 阶段目标

- 继续用 Tauri MCP 真窗验证 `#824` 的两条核心验收：
  - `网络/会话` 页的活跃会话数 `<5`
  - 点击每张活跃卡片后，右栏要么正常打开 Terminal，要么明确显示失败/断开态，并留下可追溯的 `agent-hub` 日志
- 在此基础上，补掉 superseded session 被退休后仍残留 live PTY 的清理漏洞。

#### 观察结果

- 本轮前半段官方 `driver_session` 可直接使用：
  - 主窗口标题：`ExoMind [feature/issue-806-terminal-lifecycle] [Web:1420 RT:9124]`
  - URL：`http://localhost:1420/agents`
- 在真实窗口内先看到：
  - `会话 14`
  - `活跃会话 3`
- 三张活跃卡片逐张点击结果：
  - `86381039-a91d-440a-8c66-5992b962fcb6`
    - 正常打开右栏 Terminal
    - 现场日志：
      - `[agent-hub][pty][open] requested`
      - `[agent-hub][pty][open] terminal panel opened`
  - `5e994c0d-a8b7-4ecd-94a7-027046c824e6`
    - 正常打开右栏 Terminal
    - 现场日志同样命中：
      - `requested`
      - `terminal panel opened`
  - `96a9ae3a-d423-4d52-872e-7202227dce02`
    - 不再停留在旧 Terminal
    - 右栏明确显示断开/失败提示：
      - `Terminal 已断开，自动恢复失败；下方将展示关闭前历史，可结束后归档。`
    - 现场日志命中：
      - `[agent-hub][pty][open] requested`
      - `[agent-hub][pty][open] session PTY is disconnected`
      - `[agent-hub][pty][open] disconnected terminal history panel opened`
      - `[agent-hub][pty][open] auto-resume failed; falling back to disconnected history view`
- 在继续复验 superseded/重复历史 session 收敛时，又观察到一个尾巴问题：
  - 某些 superseded session 已被 `PATCH /sessions/:id` 推进到 `archived`
  - 但它绑定的旧 PTY 仍可能残留在 live `/pty` 列表里
  - 根因是部分前端路径只做了 session retirement，没有稳定先 stop superseded PTY
- 为此，本轮新增前端补丁：
  - duplicate historical session / occupied historical session 的退休路径统一改走 `reconcileSupersededTerminalSession(...)`
  - superseded PTY 的 stop 不再依赖本地 `knownPtyIds` 命中才执行，而是直接尝试 stop，并把 `404` 视为已清理
  - 新增单测确保“即便本地 live PTY 列表尚未刷新，也会先 stop superseded PTY 再退休 session”
- 代码侧验证结果：
  - `bunx tsc --noEmit`
  - `bunx vitest run tests/unit/ui/agent-hub/agents-page.issue806.test.tsx tests/unit/ui/agent-hub/agents-page.session-actions.issue523.test.tsx tests/unit/hooks/use-session-stream.multihost.test.tsx`
  - 结果：`3` 个测试文件、`30` 个测试全部通过

#### 结论

- `#824` 的主用户故事已经在 Tauri 真窗里打通：
  - 活跃会话数保持 `<5`
  - 点击活跃卡片不再“点了没反应/卡在旧 Terminal”
  - live 会话能正常打开，stale/disconnected 会话会明确失败并留下 trace log
- 本轮新增补丁进一步收紧了 superseded session 的尾部清理：
  - 不再只把旧 session 状态推进到 `archived`
  - 还会主动尝试 stop 旧 PTY，减少“session 已退休但 live PTY 还挂着”的残留
- 另一个与业务无关、但需要记住的事实：
  - 官方 `driver_session` 在本轮后半段再次出现 `Transport closed`
  - 这类 bridge 断连不能直接等同于产品回归，先区分“工具链断桥”与“应用行为失效”

#### 可复用操作套路

1. 先用 `webview_dom_snapshot(type=accessibility)` 记录：
   - `会话`
   - `活跃会话`
   - 右栏是否出现断开提示
2. 再用 `webview_execute_js` 读取当前 `session-card-*`，拿到精确 session id 后逐张点击。
3. 点击后同时取证三层：
   - 右栏文本是否变成 live terminal 或 disconnected history
   - `agent-hub` 的 `requested / terminal panel opened / session PTY is disconnected / auto-resume failed`
   - 必要时补查 RT `/sessions` 与 `/pty`
4. 如果官方 `driver_session` 中途掉成 `Transport closed`：
   - 先确认 `1420 / 9124 / 9223` 端口是否还活着
   - 再判断是 bridge 工具层问题，还是应用/RT 本身真的挂了
5. 遇到 superseded/重复历史 session 时，不要只验 session 状态是否变成 `archived`
   - 还要同步确认旧 PTY 是否被 stop
   - 否则容易留下“UI 看起来干净，但 RT 里还有 live PTY”的假收敛

### 阶段补记：#824 断开历史面板占焦点时不再反向退休新 live 会话（2026-04-03 深夜）

#### 阶段目标

- 修复并复验一个更隐蔽的 `#824` 现场：
  - 某个 recoverable 断开会话仍占着右栏/fullscreen 焦点
  - 用户点击它后会自动恢复出新的 live PTY
  - 但旧的 canonical 打分会把“占焦点的断开旧会话”误判成 canonical，进而把新 live session 也一起 retirement，留下 orphan PTY
- 额外确认：
  - `活跃会话` 计数仍与 RT `/sessions` 对齐
  - 点击活跃卡片后要么进入明确断开态，要么恢复出新 Terminal，不再出现“两个 session 都被归档但 PTY 还活着”的反向收敛

#### 观察结果

- 新问题根因已在代码里坐实：
  - historical canonical 选择时，旧逻辑会给 `activePtyId` / `tiledPaneOrder` 加高权重
  - 即便该 PTY 已经断开，只要它还占着右栏或平铺位，分数仍可能压过刚恢复出来的新 live session
  - 同时，本地 `knownPtyIds` 之前把 `/pty` 列表里的 `stopped` PTY 也当成“已知 live PTY”
- 现场日志曾出现典型互退迹象：
  - `retired superseded terminal session { sessionId: <new>, supersededBySessionId: <old> }`
  - 随后又出现：
  - `retired superseded terminal session { sessionId: <old>, supersededBySessionId: <new> }`
  - 最终表现为：
  - UI 活跃数下降了
  - 但 RT `/pty` 里还有孤儿 running PTY

#### 本轮修复

- `AgentsPage` 的 historical occupancy 打分改成只让 **live PTY** 吃到这些 canonical 加分：
  - `activePtyId`
  - `tiledPaneOrder`
  - `knownPtyIds`
- `knownPtyIds` 现在只收录 `/pty` 返回里 `status === "running"` 的 PTY。
- 新增回归测试：
  - `does not retire a freshly recovered live session just because a disconnected history panel was focused`

#### 真窗复验

- 当前 Tauri 主窗口：
  - `ExoMind [feature/issue-806-terminal-lifecycle] [Web:1420 RT:9124]`
  - URL：`http://localhost:1420/agents`
- 修复后，`会话` 视图现场为：
  - `会话 12`
  - `活跃会话 1`
- 同时直接查 RT：
  - `/sessions` -> `runningCount = 1`
  - 初始 `/pty` 里只有旧条目，且没有 live PTY
- 点击唯一活跃卡片 `86381039-a91d-440a-8c66-5992b962fcb6` 后，真实窗口链路为：
  - 先进入断开历史视图
  - 控制台依次出现：
    - `[agent-hub][pty][open] requested`
    - `[agent-hub][pty][open] session PTY is disconnected`
    - `[agent-hub][pty][open] disconnected terminal history panel opened`
    - `[agent-hub][pty][open] resumed disconnected terminal session`
    - `[agent-hub][pty] superseded terminal session retirement step already satisfied after conflict`
  - 右栏最终显示 live Terminal，而不是卡住或停留在旧断开态
- 点击后的 RT 真相：
  - `/sessions` 只剩新的 running session：
    - `8d6efe7d-4814-46ca-a6f7-95136b13a21f`
  - `/pty` 里新的 running PTY 与之对应：
    - `8d6efe7d-4814-46ca-a6f7-95136b13a21f`
  - 旧 session `86381039-a91d-440a-8c66-5992b962fcb6` 被退休
  - 没再出现“新 session 也被反向归档，只剩 orphan PTY”的现场

#### 结论

- 这轮修复后，historical canonical 的优先级终于与真实“live/断开”状态对齐：
  - 断开旧会话即便占着右栏焦点，也不会再压过新恢复出来的 live session
- `#824` 的验收在本轮实窗里进一步收紧：
  - 活跃会话数 `<5`
  - UI 与 `/sessions` running 数一致
  - 点击活跃卡片会给出明确断开反馈并恢复，或明确失败，不再反向制造 orphan PTY

#### 可复用操作套路

1. 遇到“点击 recoverable 断开卡片后，活跃数变少了但 RT 里还有 PTY”时，先怀疑 canonical 打分而不是先怀疑 resume 本身。
2. 同时看三层证据：
   - `webview_dom_snapshot` 里的 `活跃会话`
   - RT `/sessions`
   - RT `/pty`
3. 如果日志里出现双向 superseded retirement：
   - `new -> old`
   - `old -> new`
     优先检查：
   - `activePtyId` 是否给了断开会话额外加分
   - `/pty` 的 `stopped` 条目是否被误当成 live
4. 验证“不再 orphan”不要只看 UI：
   - 点击恢复后再查一次 `/sessions`
   - 再查一次 `/pty`
   - 确认 running session 与 running PTY 一一对应

## 持续更新约定

- 每完成一个 Tauri MCP 阶段目标，就在本文档追加：
  - 阶段目标
  - 观察结果
  - 结论
  - 对后续 Agent 有复用价值的操作套路
- 不另建新的临时“排查总结”文档，避免经验碎片化。

### 阶段补记：#828 清理残留进程后，#806 / #824 真窗链路恢复验证（2026-04-03）

#### 阶段目标

- 在用户手动执行 `taskkill bun.exe node.exe cargo.exe` 后，确认这次故障是否主要属于 `#828` 的环境层残留进程问题，而不是新的 `#806 / #824` 产品回归。
- 用 Tauri MCP 重新实测两条主线：
  - `网络 -> 会话` 页的活跃会话数是否 `< 5`，且与 RT 侧 running PTY / 非 archived session 口径一致
  - 点击会话卡片进入右侧 `Terminal` 时，是否能够“正常打开”或“明确失败并给出 UI + console trace”
- 顺带确认 `请求箱` 不再停在“请求箱加载中...”。

#### 观察结果

- `driver_session` 可正常连上桌面实例：
  - 主窗口标题：`ExoMind [feature/issue-806-terminal-lifecycle] [Web:1420 RT:9124]`
  - 主窗口 URL：`http://localhost:1420/agents`
- 当前 RT 直查结果：
  - `GET http://127.0.0.1:9124/health` -> `{"status":"ok"}`
  - `GET http://127.0.0.1:9124/pty` -> `ptyTotal = 2`，其中 `ptyRunning = 1`
  - `GET http://127.0.0.1:9124/sessions` -> `total = 103`
  - 按前端当前口径过滤 `status !== "archived"` 后：
    - `visible = 12`
    - `active = 1`
    - `completed = 11`
- `会话` 页真实窗口与 RT 口径一致：
  - UI 显示：`会话 12`
  - UI 显示：`活跃会话 1`
  - 这与 `/sessions` 过滤后的 `visible = 12 / active = 1` 一致
  - 也与 `/pty` 的 `ptyRunning = 1` 一致
- 点击唯一活跃卡片后：
  - console 出现：
    - `[agent-hub][pty][open] requested`
    - `[agent-hub][pty][open] terminal panel opened`
  - 未出现“点了没反应”或无限卡住
- 点击一个已完成卡片后：
  - UI 明确出现红色提示：
    - `Terminal 已断开，无法恢复；下方将展示关闭前历史，可结束后归档。`
  - 右栏同时出现两段明确说明：
    - `当前 PTY 已不存在，RT 可能已经重启。下方保留关闭前历史；如需结束，可点击上方“结束”收敛后归档。`
    - `Terminal 已断开，无法恢复；下方将展示关闭前历史，可结束后归档。`
  - console 出现：
    - `[agent-hub][pty][open] requested`
    - `[agent-hub][pty][open] session PTY is disconnected`
    - `[agent-hub][pty][open] disconnected terminal history panel opened`
- 切到 `请求箱` 页后：
  - 页面正常进入并渲染统计卡与筛选按钮
  - 未再停在 `请求箱加载中...`
  - 本轮现场为零提案空状态，但页面可用

#### 结论

- 这轮现场里，“界面卡住 / 请求箱加载中”在 `taskkill bun/node/cargo` 后恢复，进一步坐实：
  - 残留进程占住 `9124` 属于独立环境层问题，应该继续放在 `#828` 跟踪
  - 它会把 `#806 / #824` 的前端表现伪装成“页面卡死”或“Terminal 没反应”
- 在清掉残留进程后，当前实现分支上的 `#806 / #824` 主链路已经能在 Tauri MCP 真窗里通过：
  - 活跃会话数 `< 5`
  - UI 与 RT 过滤口径一致
  - 点击 live 会话可打开 Terminal
  - 点击 stale/completed 会话会明确失败并留下 trace
  - 请求箱可正常加载
- 因此后续排查必须先区分：
  - `#828` 环境层：端口占用 / embedded RT 自启动失败 / bridge 异常
  - `#806 / #824` 产品层：会话生命周期、Terminal 打开、失败反馈、请求箱加载

#### 可复用操作套路

1. 先查三层基础活性：
   - `driver_session status`
   - `GET /health`
   - `Get-NetTCPConnection -LocalPort 9124`
2. 再用 RT 直查和 UI 对数：
   - `/pty` 看 running PTY 数
   - `/sessions` 按 `status !== "archived"` 统计 `visible / active / completed`
   - 去 `网络 -> 会话` 看 UI 是否一致
3. 点卡片时同时取两层证据：
   - UI 是否进入 live Terminal 或明确失败态
   - `read_logs source=console` 是否命中 `agent-hub][pty][open] ...`
4. 如果用户说“请求箱加载中...”：
   - 先不要急着判定是 `ProposalInboxPage` 回归
   - 先排除 `9124` 被残留 `bun/node/cargo` 占住，导致 embedded RT 自启动失败

### 阶段补记：MCP Bridge Ready 后仍需显式 start session（2026-04-04）

#### 阶段目标

- 收敛一条可重复执行的 Tauri MCP 重连前置动作，避免在真窗排查开始前把“桥已就绪但 session 未挂上”误判成桥接失败。

#### 观察结果

- 用户重启 `bun run tauri dev` 后，页面控制台已出现：
  - `[MCP][BRIDGE][INFO] Tauri API available, initializing bridge`
  - `[MCP][BRIDGE][INFO] Console capture initialized`
  - `[MCP][BRIDGE][INFO] Ready`
- 即便如此，`driver_session status` 起初仍可能返回：
  - `connected: false`
- 这时不需要先判定 bridge 坏掉；直接执行：
  - `driver_session start --port 9223`
- 本轮现场里，显式 `start` 后即可成功接入当前实例。
- 接入成功后再做“当前唯一实例”交叉验证，口径应拆成两段：
  - `9124` 与 `9223` 必须由同一个 `exomind.exe` 持有；这是 RT 与 MCP bridge 同属一台桌面实例的硬证据
  - `1420` 不要求和 `exomind.exe` 同 PID；它通常是 Vite/Node 进程在监听。要确认它属于同一实例，应该看当前被接管的 `main` 窗口 URL 是否就是 `http://localhost:1420/...`
- 因而本轮现场能确认的是：
  - 当前只存在一组 `UI 1420 / RT 9124 / MCP 9223`
  - 其中 `9124` 与 `9223` 同属一个 `exomind.exe`
  - 该 `exomind.exe` 的主窗口实际加载的是 `http://localhost:1420`

#### 结论

- 控制台出现 `[MCP][BRIDGE][INFO] Ready`，只能说明 webview 内的 bridge 脚本已完成初始化；它不等同于 `driver_session` 已自动挂接成功，更不等同于后续 MCP 工具调用已经可用。
- 因此在 Windows 下做 ExoMind 真窗调试时：
  - `driver_session status = connected:false`
  - 不能直接推出 “MCP bridge 不可用”
- 更准确的三层判断应是：
  - `Ready` = bridge 层已初始化
  - `driver_session start --port 9223` 成功，且 `status=connected:true` = 工具接管层已连上
  - `manage_window list` / `webview_*` 能正常返回 = 工具调用层真的可用
- 更稳的判定方式是：
  - 先显式 `driver_session start --port 9223`
  - 再结合 `1420 / 9124 / 9223` 的端口归属与窗口 URL，确认当前实例是否正确对齐
- 这一步应视为真窗排查前的固定动作，而不是异常时才尝试的补救动作。

#### 可复用操作套路

1. 先看页面控制台是否已出现 `[MCP][BRIDGE][INFO] Ready`。
2. 不管 `driver_session status` 是否还是 `connected:false`，都先执行一次：
   - `driver_session start --port 9223`
3. `start` 之后先确认工具层真的挂上了：
   - `driver_session status`
   - 期待看到 `connected: true`
4. 再核对“唯一实例”是否对齐：
   - `Get-NetTCPConnection -State Listen -LocalPort 9124,9223 | Select-Object LocalPort,OwningProcess`
   - 确认 `9124` 与 `9223` 的 `OwningProcess` 完全相同
   - `Get-Process -Id <上一步 PID> | Select-Object Id,ProcessName,Path`
   - 确认它确实是当前那一个 `exomind.exe`
5. 最后确认 UI 端口是否绑定到这台实例：
   - `Get-NetTCPConnection -State Listen -LocalPort 1420`
   - 再用 `manage_window list` 或 `webview_execute_js` 看主窗口 URL
   - 只有当主窗口 URL 指向 `http://localhost:1420/...` 时，才能判定 `UI1420/RT9124/MCP9223` 已对齐到同一实例
6. 只有在“显式 start 后仍失败”时，才进入下一层排查：
   - 端口占用冲突
   - 幽灵 `exomind.exe`
   - bridge 未绑定到当前实例

### 阶段补记：#811 九条终端叙事在 `issue806-g` 真窗通过（2026-04-04）

#### 阶段目标

- 用当前唯一存活实例 `issue806-g / UI 1420 / RT 9124 / raw bridge 9223`，把 `#811` 收敛成一份真正可执行的九条用户叙事章程。
- 让章程同时验证：
  - `拓扑图 / 会话 / 平铺` 三个子页面的 PTY 恢复与切换
  - 从 `任务 -> 网络` 的子页面持久化
  - RT 重启前后 Claude Code / Codex 会话恢复
- 补齐“点击拓扑 PTY 节点时无结构化 trace”的调试缺口。

#### 观察结果

- 官方 `driver_session` 在本轮现场仍直接报：
  - `Transport closed`
- 但 raw bridge `ws://127.0.0.1:9223` 持续可用，且足以驱动整套真窗章程。
- `scripts/dev/tauri-mcp-issue806-charter.ts` 本轮补了三类稳定性修复：
  - 切回 `网络` 页后，等待拓扑 PTY 节点真正挂上再断言，不再把子页面重挂载的瞬时空窗误判成“节点缺失”
  - 点击前先等待 session card / topology node 选择器出现，减少多视图切换中的 DOM 抖动误报
  - 读取 RT `/sessions` / `/pty` 时加浏览器侧超时，并在 pre-restart 阶段允许回退到 `sessions.sqlite` 作为 RT 真值
- 前端本体也补上了：
  - 点击拓扑 PTY 节点时输出
    - `[agent-hub][pty][open] requested`
    - `[agent-hub][pty][open] terminal panel opened`
  - 这样拓扑图与会话卡的 PTY 打开链路都具备统一 trace
- 真窗最终章程命令：
  - `bun scripts/dev/tauri-mcp-issue806-charter.ts --name issue806-g --web-port 1420 --bridge-port 9223 --runtime-db .tmp/tauri-dev-state/issue806-g/app-data/runtime/sessions.sqlite`
- 本轮最终结果：
  - `overallPass: true`
  - `activeCount: 2`
  - `mismatchCount: 0`

#### 结论

- `#811` 当前阶段的九条终端用户叙事，已经在真实桌面实例中跑通。
- 真窗验收里需要把 “页面 RT HTTP 抽样” 和 “RT 真值” 区分开：
  - 优先用页面上下文直接读 `/sessions` / `/pty`
  - 若 raw bridge 下这一层短时失真，不直接判产品失败，而是回退到 `sessions.sqlite`
- “拓扑节点可见”和“拓扑节点可点击”现在都已具备：
  - UI 反馈
  - Terminal 内容
  - `agent-hub` 结构化 trace

#### 可复用操作套路

1. 真窗前置先认定官方 MCP 是否可用；若仍是 `Transport closed`，直接切 raw bridge，不要空耗在 `driver_session`。
2. 跑九条叙事章程时，先保证实例参数明确：
   - `--name issue806-g`
   - `--web-port 1420`
   - `--bridge-port 9223`
   - `--runtime-db .tmp/tauri-dev-state/issue806-g/app-data/runtime/sessions.sqlite`
3. 若章程只在 `拓扑图` 失败，先怀疑章程是否抢跑：
   - 是否只等到了 `agent-topology-view`
   - 是否真的等到了 `[data-testid^="rf__node-pty-"]`
4. 若章程只在 pre-restart UI/RT 对账失败，但重启前后 PTY 行为都正常：
   - 先看页面上下文 `/sessions` / `/pty` 是否只是暂时超时
   - 再用 `sessions.sqlite` 复核 RT 真值
5. 后续任何 Agent 只要改了拓扑 PTY 打开链路，都必须同时复核三件事：
   - 拓扑节点能打开右侧 Terminal
   - 控制台存在 `[agent-hub][pty][open]` trace
   - 九条章程再次 `overallPass: true`

### 阶段补记：`web-1420` 现场继续通过九条章程，PTY 失败态已显式出屏（2026-04-04）

#### 阶段目标

- 在用户重启并清空外心相关进程后，重新确认当前唯一实例 `UI 1420 / RT 9124 / raw bridge 9223` 仍可完成九条终端叙事验收。
- 收敛“PTY 加载失败时 UI 不应一直卡在会话加载中”的现场证据，并把这轮判断写成可复用经验。

#### 观察结果

- 当前端口归属重新确认后：
  - `1420` 正在监听
  - `9124` 正在监听
  - `9223` 正在监听
  - `9124` 与 `9223` 仍由同一个 `exomind.exe` 持有
- 官方 `driver_session status` 这轮依旧直接返回：
  - `Transport closed`
- 但 raw bridge 章程仍可直接跑通：
  - `bun scripts/dev/tauri-mcp-issue806-charter.ts --name web-1420 --web-port 1420 --bridge-port 9223 --runtime-db .tmp/tauri-dev-state/web-1420/app-data/runtime/sessions.sqlite`
- 本轮生成报告：
  - `.tmp/reports/tauri-mcp-issue806-charter/2026-04-04T09-37-14.437Z-web-1420.json`
  - `.tmp/reports/tauri-mcp-issue806-charter/2026-04-04T09-37-14.437Z-web-1420.md`
- 章程结果：
  - `overallPass = true`
  - `activeCount = 1`
  - `mismatchCount = 0`
- 九条叙事结果：
  - `story-1/2/3/4/6/7/8/9 = passed`
  - `story-5 = skipped`
  - 跳过原因不是功能失败，而是现场只有 `1` 个活跃会话，不足以验证“多张活跃卡片来回切换”
- 这轮 completed session 卡片的真实 UI 结果已经变成：
  - 先出现终端加载态
  - 再落到断开历史 / 失败态
  - UI 文案明确显示：`Terminal 会话已结束；下方将展示关闭前历史，可继续归档。`
  - 控制台仍保留 `[agent-hub][pty][open]` trace

#### 结论

- 当前 `web-1420` 现场再次证明：
  - 即使官方 `driver_session` 仍是 `Transport closed`
  - 只要 raw bridge 还活着，就能继续对真实桌面窗口执行产品级验收
- 对“PTY 加载失败/会话不可恢复”的体验要求，这轮可以确认已经满足最小闭环：
  - UI 不再无限停留在 `会话加载中...`
  - 会明确落成简短失败/断开提示
  - 控制台存在可追溯 trace
- 因而后续遇到用户反馈“卡在加载中”时，判断顺序应该变成：
  1. 先确认是不是旧实例/残留进程导致 RT 根本没起来
  2. 再确认当前代码是否已经把初始 PTY 流失败收敛为显式错误 UI
  3. 最后才继续排查具体会话恢复逻辑

#### 可复用操作套路

1. 先用三条快速真值确认当前实例还活着：
   - `Get-NetTCPConnection -State Listen -LocalPort 1420,9124,9223`
   - `Invoke-WebRequest http://127.0.0.1:9124/health`
   - `driver_session status`
2. 如果 `driver_session` 仍是 `Transport closed`，不要阻塞，直接改跑：
   - `bun scripts/dev/tauri-mcp-issue806-charter.ts --name web-1420 --web-port 1420 --bridge-port 9223 --runtime-db .tmp/tauri-dev-state/web-1420/app-data/runtime/sessions.sqlite`
3. 看章程结果时，优先盯三项：
   - `overallPass`
   - `mismatchCount`
   - `Nine-Story Charter Checks`
4. 对“失败 UI 是否真的出屏”的证据，不要只看 active session：
   - 还要点至少一张 completed session card
   - 确认它不是无响应，而是进入断开历史/失败态并有明确文案
5. 如果本轮活跃会话数少于 `2`：
   - `story-5` 可以接受 `skipped`
   - 但必须在报告里写明跳过原因是“现场活跃会话不足”，不是脚本或产品失败

### 阶段补记：#818 需要先造出 fullscreen 恢复前置态，再做 RT 重启验收（2026-04-04）

#### 阶段目标

- 把 `#818` 的核心验收从“RT 重启后活跃会话总数恢复”收紧到“RT 重启后，基于已持久化的 fullscreen PTY 恢复信息自动恢复 Claude / Codex 终端上下文”。
- 避免章程在“当前实例根本没有活跃 fullscreen 终端快照”时误跑，导致把空前置态误判成产品失败。

#### 观察结果

- 当前 `issue806-g / UI 1420 / RT 9124 / raw bridge 9223` 现场里，若直接跑：
  - `bun scripts/dev/tauri-mcp-issue806-charter.ts --name issue806-g --web-port 1420 --bridge-port 9223 --runtime-db .tmp/tauri-dev-state/issue806-g/app-data/runtime/sessions.sqlite`
    但当前窗口没有任何活跃终端、`localStorage.exomind:agentHubTiledState` 也没有 `fullscreenTerminalRecovery`，章程会在 RT 重启恢复阶段超时。
- 这不一定说明产品回归，更常见的真实原因是：
  - 当前实例没有 `#818` 所需的前置态
  - 也就是没有 “Claude/Codex 活跃终端 + 已打开右侧 PTY + fullscreen 恢复快照已落盘”
- 本轮把章程脚本补成了先自动准备前置态：
  - 确保至少存在 `claude` 与 `codex` 两类活跃 terminal agent
  - 确保 `exomind:agentHubTiledState` 中存在 `fullscreenTerminalRecovery`
  - 再执行 `runtime_service_stop/start`
- 同时把 RT 重启等待改成两段：
  - 先等 `runtime_service_status.running === false`
  - 再等 `runtime_service_status.running === true`
  - 不再用单纯 `sleep(1000)` 赌 RT 状态
- 本轮更新后，章程 stdout 会先输出：
  - `issue818Preparation`
  - 其中包含：
    - `status`
    - `spawnedAgents`
    - `activeTerminalCount`
    - `activeTerminalAgentKinds`
    - `fullscreenRecoveryPresent`
- 在同一现场复跑后结果：
  - `overallPass: true`
  - `activeCount: 2`
  - `mismatchCount: 0`
  - 报告：
    - `.tmp/reports/tauri-mcp-issue806-charter/2026-04-04T15-48-20.764Z-issue806-g.json`
    - `.tmp/reports/tauri-mcp-issue806-charter/2026-04-04T15-48-20.764Z-issue806-g.md`

#### 结论

- `#818` 的桌面验收不是“只要 RT 重启后还有活跃会话就算过”。
- 真正的 `#818` 前置条件必须先成立：
  - 当前窗口有活跃终端
  - 右侧 terminal 已打开
  - fullscreen 恢复快照已持久化
- 如果这三者缺任何一个，章程失败优先解释为“前置态缺失”，不是直接解释为“恢复逻辑失效”。
- 另一个经验是：
  - raw bridge 下长时间的大块 `execute_js` 更容易触发脚本执行超时
  - stop/start/recovery 相关验证要拆成短调用与轮询，不要把所有 fetch、DOM 读取、状态机等待堆进一次长脚本

#### 可复用操作套路

1. 跑 `#818` 章程前，先确认当前实例里是否已有前置态：
   - 活跃 Claude/Codex terminal agent
   - `agent-rightpanel-pty-terminal`
   - `localStorage.exomind:agentHubTiledState.fullscreenTerminalRecovery`
2. 如果没有，不要先怪恢复逻辑；先让章程或人工步骤补齐前置态。
3. 通过 raw bridge 做 RT 重启时，固定拆成两段等待：
   - `runtime_service_stop` 后等 `running=false`
   - `runtime_service_start` 后等 `running=true`
4. 桌面桥接里需要读取大量状态时：
   - 把 `runtime_service_status`
   - DOM 状态
   - `/sessions`
   - `/pty`
     拆成短脚本或短轮询；不要塞进一个超长 `execute_js`
5. 当章程 stdout 出现：
   - `issue818Preparation.status = ready/prepared`
   - `fullscreenRecoveryPresent = true`
     再开始解读后面的 RT 重启恢复结果，才是有效的 `#818` 验收

### 阶段补记：冲突收敛后再次回归验证 #806 / #818（2026-04-05）

#### 阶段目标

- 在 `feature/issue-806-terminal-lifecycle` 与 `dev` 完成合并冲突收敛后，再次确认：
  - `#806` 相关终端生命周期单测没有被合并回归破坏
  - `#818` 的九条桌面终端用户叙事仍可在真实 Tauri dev 实例里完整跑通
- 同时确认官方 Tauri MCP 工具链在当前现场可直接连接并读取窗口/DOM，而不必退回“仅 raw bridge 可用”的保守模式。

#### 观察结果

- 本轮现场可直接连上官方 Tauri MCP：
  - `driver_session start --host 127.0.0.1 --port 9223`
  - `manage_window list` 正常返回主窗口、Now overlay、Voice overlay
  - `ipc_get_backend_state` 正常返回：
    - `identifier = com.exomind.app`
    - `tauri.version = 2.10.3`
    - `window_count = 3`
- 主窗口标题和 URL 显示当前真实实例为：
  - `ExoMind [feature/issue-806-terminal-lifecycle] [Web:1420 RT:9124]`
  - `http://localhost:1420/agents`
- 本轮代码侧针对性验证通过：
  - `bunx tsc --noEmit`
  - `bunx vitest run tests/unit/ui/agent-hub/agents-page.issue806.test.tsx tests/unit/ui/agent-hub/pty-session-recovery.test.ts tests/unit/ui/agent-hub/agents-tiled-persistence.test.tsx tests/unit/ui/agent-hub/pty-spawn-dialog.test.tsx`
- 本轮桌面章程实测通过：
  - `bun scripts/dev/tauri-mcp-issue806-charter.ts --name web-1420 --web-port 1420 --bridge-port 9223 --runtime-db .tmp/tauri-dev-state/web-1420/app-data/runtime/sessions.sqlite`
  - stdout 结果：
    - `issue818Preparation.status = ready`
    - `overallPass = true`
    - `activeCount = 2`
    - `mismatchCount = 0`
  - 报告路径：
    - `.tmp/reports/tauri-mcp-issue806-charter/2026-04-04T19-48-51.282Z-web-1420.json`
    - `.tmp/reports/tauri-mcp-issue806-charter/2026-04-04T19-48-51.282Z-web-1420.md`
- 章程报告确认九条叙事全部 `PASSED`：
  - `story-1` 到 `story-9` 全部通过
  - RT 重启前后：
    - UI active/completed/total = `2/14/16 -> 2/14/16`
    - RT active/completed/total = `2/14/16 -> 2/14/16`
    - `mismatchCount = 0`
- 本轮还用官方 Tauri MCP 工具补做了代表性手动抽查：
  - 当前窗口可读到：
    - `/agents`
    - `localStorage.exomind:agentHubViewMode = sessions/tiled`
  - 从 `任务` 返回 `网络` 后，`storedViewMode = sessions` 的恢复被再次确认
  - 点击 `平铺` 后，`storedViewMode = tiled`、`tiledVisible = true`
  - 点击平铺窗格后，未观察到右侧 terminal 重新占用

#### 结论

- 这轮可以确认：`dev` 合并冲突收敛后，`#806` / `#818` 的关键终端叙事没有被语义回归破坏。
- 当前环境已经不需要再把“官方 Tauri MCP 会断”当作默认前提：
  - 至少在这轮 `web-1420 / RT 9124 / bridge 9223` 现场里，官方 MCP 的窗口、DOM、JS、IPC 读取都可用
  - raw bridge 仍然有价值，但更多是章程脚本的自动化执行层，不再是唯一验收入口
- 章程与官方 Tauri MCP 抽查组合起来后，本轮可以把验收结论定性为：
  - 代码层回归测试通过
  - 桌面真实窗口叙事通过
  - RT 重启后的终端会话自动恢复通过

#### 可复用操作套路

1. 冲突收敛后的终端回归，不要只跑单测：
   - 先跑 `bunx tsc --noEmit`
   - 再跑 `agents-page.issue806 + pty-session-recovery + agents-tiled-persistence + pty-spawn-dialog`
   - 最后一定补跑一次桌面章程
2. 若当前实例就是 `web-1420 / bridge 9223 / RT 9124`，可以直接复用：
   - `bun scripts/dev/tauri-mcp-issue806-charter.ts --name web-1420 --web-port 1420 --bridge-port 9223 --runtime-db .tmp/tauri-dev-state/web-1420/app-data/runtime/sessions.sqlite`
3. 看章程结果时，固定先看四项：
   - `issue818Preparation.status`
   - `overallPass`
   - `activeCount`
   - `mismatchCount`
4. 当官方 Tauri MCP 可用时，补两条代表性现场抽查即可：
   - 读 `window.location.pathname` + `localStorage.exomind:agentHubViewMode`
   - 读当前 `tiledVisible / sessionsVisible / topologyVisible`
     这样能快速确认“导航持久化”和“当前页面真相”
5. 如果章程通过、官方 MCP 抽查也通过，就不要继续怀疑“还有隐藏冲突”：
   - 这时应把问题切换到新的功能需求或新的现场故障

### 跨阶段总则：Windows 下 Tauri MCP 桌面调试（2026-04-05 收敛）

#### 适用范围

- 这一节只收敛跨阶段反复成立的方法论。
- 后续阶段补记默认不再重复这些共性，只补各阶段新增观察、新增结论和新增坑点。

#### 已稳定成立的共通知识

- `driver_session connected=true` 只说明桥接层已连，不说明窗口、DOM、JS、IPC、日志读取都稳定可用。
- 实例识别必须同时看“当前窗口真相”和“当前 dev 实例目录”：
  - 先看主窗口标题和 URL
  - 再看 `.tmp/tauri-dev-state/<instance>/...`
  - `%APPDATA%/com.exomind.app` 只当 legacy/shared 参考，不默认视为当前 `tauri dev` 实例
- 官方 Tauri MCP 与 raw bridge 应按角色分工，不要在文档里把它们写成绝对二选一：
  - 官方 Tauri MCP 更适合窗口、导航、DOM、日志、短 JS 读取
  - raw bridge 更适合作为 fallback，或承载现有章程/定制 bridge 脚本
- 桌面验收里的长脚本要拆小：
  - `execute_js`、stop/start/poll、状态读取不要塞进一个大调用
  - 优先拆成多个 1-2 秒内可返回的短调用
- 焦点相关交互要先区分“驱动限制”和“产品失效”：
  - `document.hasFocus() = false`
  - `navigator.clipboard.writeText(...)` / 键盘输入失败
  - 这类现象优先解释为前台焦点限制，不直接判产品坏
- 对 RT 或 PTY 交互，优先走页面内同路径验证，而不是外部旁路猜测：
  - 页面内 `fetch('/sessions')`、`fetch('/pty')`
  - 页面内 PTY input WebSocket helper
  - 页面内 PTY output WebSocket

#### 固定排障顺序

1. 先确认连的是不是正确实例：
   - `manage_window list`
   - 主窗口标题中的 `Web:<port> RT:<port>`
   - 主窗口 URL
   - 对应 `runtime-db` / `.tmp/tauri-dev-state/<instance>/...`
2. 再确认当前 MCP/bridge 是“真可用”而不是“只显示 connected”：
   - 最短 `execute_js`
   - `runtime_service_status`
   - 一次 `/sessions` 或 `/pty`
3. 再进入具体业务断言：
   - 终端恢复
   - PTY 输入
   - 图编辑器交互
   - 浮层/面板状态
4. 如果验证链路里出现超时、空日志、键盘失败，先回到前两步，不直接把责任压到产品逻辑。

#### 当前固定套路

1. RT 重启恢复一律拆成小步骤：
   - `runtime_service_stop`
   - 单独读一次 `runtime_service_status`
   - `runtime_service_start`
   - 再分别读 `runtime_service_status`、`/sessions`、`/pty`
2. PTY 输入若受焦点限制，不直接依赖 MCP 键盘/剪贴板：
   - 先确认 `.xterm` 已渲染
   - 再走与 `PtyTerminal.sendTextInput()` 同路径的页面内 `fetch`
   - 以 `204` 与页面回显 marker 作为断言
3. 如果实例名混用，先停下来重核实例：
   - 选错实例最容易把“前置态缺失”误判成“恢复逻辑失败”
4. 若文中出现 `web-1420`、`issue806-g`、`9223`、`9124` 这类值，默认都只是当时现场样例：
   - 复用前必须替换成当前窗口标题、当前 bridge 端口和当前实例路径

### 阶段补记：#834 任务 DAG 交互 bug 与沉浸面板验收（2026-04-05 ~ 2026-04-06）

#### 阶段目标

- 用真实桌面窗口而不是纯 Web / 纯 curl 方式，定位并验证任务 DAG 在强聚焦 + 手动拖拽下的交互回归。
- 在上面的跨阶段总则之外，补齐“图编辑器交互 bug + 沉浸面板状态验证”的专用套路。

#### 本轮观察结果

- 本轮现场样例是：
  - 主窗口：`ExoMind [dev] [Web:1420 RT:9124]`
  - route：`/tasks/dag`
  - embedded RT：`0.0.0.0:9124`
  - target mode：`embedded`
- 当前 DAG 现场的关键不是“桥能不能连”，而是“页面里有没有稳定 detector”：
  - 这轮最稳定的证据来自页面内 debug hook
  - bridge 主要负责导航、触发少量交互、回读结果
- 仅靠 bridge 直接模拟复杂鼠标拖拽并不可靠：
  - `verify-drag --pointer-type mouse` 在当前环境下无法稳定打进 React Flow / d3-drag 的真实 mouse drag 路径
  - 但 `touch` 持续拖拽路径可稳定触发页面逻辑
- 后台监控脚本如果依赖 `Start-Process` + 输出重定向到文件，结果不稳定：
  - 日志文件可能为空
  - 页面其实仍在跑，但脚本以为“没有样本”
- 页面内 history 反而稳定：
  - `clear-history`
  - 用户操作
  - `history-current`
    这条链路比“后台 watch 写文件”更可信

#### 本轮收敛出的调试方法论

- 遇到桌面前端交互异常时，不要先猜“数据算空了”还是“渲染层丢了”。
- 先把页面内状态拆成三层并同时暴露出来：
  - 状态层：当前 graph / focused series / rendered graph ids
  - DOM 层：节点数、hidden 节点数、edge DOM/path 数、viewport transform
  - React Flow internal 层：`measured`、`handleBounds`、internal node hidden/dragging
- 真正的异常判定应在页面里完成，而不是让 bridge 脚本自己猜：
  - 页面应直接暴露：
    - `window.__EXOMIND_TASK_DAG_DEBUG__.getSnapshot()`
    - `getHistory()`
    - `clearHistory()`
- 一旦判定标准稳定，就把它变成可机读的 anomaly kinds，而不是只看 console 文本：
  - 例如：
    - `focus-anchor-hidden`
    - `all-rendered-hidden`
    - `edge-dom-zero`
    - `edge-path-zero`

#### 本轮关键结论

- 这类交互 bug 的根因不一定在上游 graph projection。
- 本轮真实坏态里，状态层仍然有 3 nodes / 2 edges，但：
  - DOM 节点被设为 `visibility:hidden`
  - edge DOM / edge path 清空
  - React Flow internal node 的 `measured` / `handleBounds` 掉到 0
- 因此，对图编辑器类桌面 bug，必须把：
  - “数据没了”
  - “DOM 没了”
  - “内部测量退化了”
    分开看。
- 另一个单独收敛出的经验是：
  - 对沉浸模式 / 浮层 / 控制面板一类交互，不要只测 DOM 存在
  - 要直接验证：
    - 默认隐藏态
    - 点击后常驻态
    - 再次点击隐藏态
    - 以及按钮 class / `aria-expanded`

#### 当前最值得复用的操作套路

1. 先确认当前桌面实例与目标页面无误：
   - 主窗口标题
   - `Web:<port> RT:<port>`
   - `location.pathname`
2. 对交互 bug，优先给页面加 debug hook，而不是先写复杂 bridge 自动化：
   - snapshot
   - history
   - detector
3. 追踪用户手工复现时，优先用：
   - `clear-history`
   - 用户真实操作
   - `history-current`
   - 不优先依赖后台日志文件
4. 需要自动验证时，先选“页面里本来就稳定的交互路径”：
   - 当前 DAG 现场优先 `touch` 持续拖拽
   - 不要强行把 `mouse` automation 失败直接解释成产品仍有 bug
5. 判断是否修复成功，至少同时看：
   - anomaly kinds 是否为空
   - DOM 节点/边是否仍在
   - internal `measured` / `handleBounds` 是否恢复
6. 对浮层 / 沉浸模式 UI，bridge 验证优先读取：
   - `aria-expanded`
   - className 里是否仍有 `opacity-0`
   - 面板 DOM 是否真正存在

#### 本轮明确踩过的坑

- 坑 1：把 bridge 自动化失败误判成页面仍失败
  - 当前现场里，`mouse` 持续拖拽自动化进不去真实 mouse drag 路径
  - 这只能说明模拟受限，不能直接说明页面逻辑没修好
- 坑 2：把后台日志文件为空误判成“没有异常/没有样本”
  - `Start-Process` 重定向输出在当前 Windows 现场不稳定
  - 空文件不等于页面没有变化
- 坑 3：只看 console 文本，不把判定逻辑产品化
  - 纯日志很难稳定比较“修复前后”
  - 可机读的 snapshot / history / anomaly kinds 更适合持续验收
- 坑 4：只看 DOM，不看 React Flow internal state
  - 图编辑器类问题里，internal measurement 退化经常才是上游原因
- 坑 5：只验证“点了会出现”，不验证“为什么消失/何时常驻”
  - 沉浸模式入口类 UI 必须把 hover reveal 和 click pin 两种状态明确区分

#### 可复用命令与脚本

- 当前 DAG bridge 调试脚本：
  - `bun scripts/dev/verify-task-dag-834-tauri-bridge.ts --mode detect-current`
  - `bun scripts/dev/verify-task-dag-834-tauri-bridge.ts --mode history-current`
  - `bun scripts/dev/verify-task-dag-834-tauri-bridge.ts --mode clear-history`
- 持续 touch 拖拽验证：
  - `bun scripts/dev/verify-task-dag-834-tauri-bridge.ts --anchor-id <current-anchor-id> --move-steps 30 --step-dx 8 --step-dy 0 --step-delay-ms 120 --settle-delay-ms 250`
  - 其中 `<current-anchor-id>` 只应取当前页面真实 anchor id，不复用历史样例值
- 验证思路：
  - 先 `detect-current`
  - 再 `clear-history`
  - 用户或脚本操作
  - 最后 `history-current` / 再读一次 `detect-current`

### 补充：官方 MCP 稳定验收套路（保留并入）

1. 先确认自己连的是不是对的实例：
   - 看 `manage_window list`
   - 看主窗口标题里的 `Web:1420 RT:9124`
   - 看主窗口 URL 是否真是 `http://localhost:1420/agents`
   - 再核对章程参数里的 `--name` 与 `runtime-db`
2. 先确认官方 MCP 是“真可用”而不是“只显示 connected”：
   - 先跑一个最短 `execute_js`
   - 再跑一个 `runtime_service_status`
   - 再读一次 `/sessions` 或 `/pty`
   - 这三步都过，才进入后续深水区验收
3. RT 重启恢复固定拆成小步骤：
   - `runtime_service_stop`
   - 单独查一次 `runtime_service_status`
   - `runtime_service_start`
   - 再分别查：
     - `runtime_service_status`
     - `/sessions`
     - `/pty`
   - 不要写成长轮询大脚本
4. 如果长脚本超时，不要立刻怀疑产品：
   - 先把一个大脚本拆成多个 1-2 秒内可返回的短调用
   - 用多次短读替代一次大轮询
5. 如果需要验证 PTY 输入交互，而 MCP 键盘/剪贴板因为焦点限制不稳定：
   - 先确认右侧或平铺页 `.xterm` 文本确实在渲染
   - 再用与 `PtyTerminal.sendTextInput()` 同链路的页面内 PTY input WebSocket helper 验证
   - 验证重点是：
     - 收到对应 `ack`
     - 页面 `.xterm` 文本出现 marker
   - 同时在文档里注明这是“与 UI 同路径的页面内注入”，不是 RT 外部旁路
6. 如果 `issue806-g` 与 `web-1420` 混用，先停下来重核实例：
   - 选错实例最容易把“章程前置态缺失”误判成“恢复逻辑失败”
7. 新一轮十条叙事门禁前，优先复用本轮稳定命令：
   - `bun scripts/dev/tauri-mcp-issue806-charter.ts --name web-1420 --web-port 1420 --bridge-port 9223 --runtime-db .tmp/tauri-dev-state/web-1420/app-data/runtime/sessions.sqlite`

### 阶段补记：#836 #838 #839 #841 #842 系列桌面复核（2026-04-06）

#### 阶段目标

- 在不新起实例的前提下，直接复用隔离中的 Tauri dev 实例，完成本轮终端 Agent / 平铺工作台的真实桌面验收。
- 重点覆盖：
  - `#836` 独立 PTY 路由不再 404
  - `#838` 历史会话卡片标题优先展示 rename 后标题
  - `#839` PTY 空闲自动进入 `waiting_input`，真实 PTY 输入后回到 `running`
  - `#841/#855` 命名布局下的异步 spawn/resume 仍能回填到原始布局
  - `#856/#857` 平铺沉浸模式与窗格高度填充

#### 观察结果

- 当前稳定可复用实例：
  - managed instance：`issue842-verify2`
  - web：`1422`
  - HMR：`1423`
  - embedded RT：`1950`
  - MCP / bridge：`9225`
- 本轮官方 MCP 基础链路稳定：
  - `driver_session status => connected=true`
  - `manage_window list` 能看到主窗口：
    - `ExoMind [dev] [Web:1422 RT:1950]`
    - `url = http://localhost:1422/agents`
- 但本轮也明确观察到一个新限制：
  - `webview_interact` / `webview_find_element` 在当前 bridge 下会报：
    - `window.__MCP__.resolveRef is not a function`
  - 结论：
    - DOM 读写不要卡死在 `interact/find_element`
    - 直接退回 `webview_execute_js`，用真实 DOM 查询与 `.click()` / `dispatchEvent(...)` 执行
- `#856/#857` 在桌面里已拿到几何和截图证据：
  - 沉浸模式下，`信号网络 / 拓扑图|会话|平铺... / Terminal / 添加` 整条工作台顶部栏消失
  - 仅保留 `X 个会话` 状态栏与 `退出沉浸`
  - `PtyTerminal` 与空窗格在 1x1 / 1x2 下都能充满窗格高度，不再需要先点 maximize
- `#836` 已在桌面中复核通过：
  - 从会话页点击 PTY 的 `全屏`
  - 主窗口进入 `/agents/pty/<ptyId>?baseUrl=...`
  - 刷新后仍保持 PTY 页面，不再落入全局 404
- `#838` 已在桌面中复核通过：
  - `启动终端会话` 弹层里的历史卡片首项显示 `Claude计划`
  - `session_id` 只出现在次级信息行
  - 占用中的历史会话显示 `已打开窗口 · Claude-93237b7d`
- `#841/#855` 的 hardest case 已通过“页面内延迟 `/pty/resume`”稳定复现：
  - 先在布局 A 打开空窗格恢复弹层
  - 用页面内 fetch patch 把 `/pty/resume` 人为延迟
  - 点击恢复后，立刻程序化切到布局 B
  - 结果：
    - 新 PTY 只写回布局 A 的 slot snapshot
    - 当前激活的布局 B 没被污染
- `#839` 已在同一实例上完成闭环：
  - 用 `POST /pty/spawn` 新建隔离 PTY：`tmcp-wait-test`
    - 命令：`powershell -NoLogo -NoProfile -NoExit -Command "Write-Output 'TMCP_WAIT_TEST'"`
  - 运行一段时间后，`GET /sessions` 观察到：
    - `status = waiting_input`
  - 再调用与前端同路径的：
    - PTY input WebSocket 唤醒字节
  - 2 秒后 `GET /sessions` 观察到：
    - `status = running`
  - 设置页也确认可见：
    - `终端等待输入超时`
    - `终端历史回放上限`
- 本轮还顺手确认一个新 UI bug 并修复：
  - `启动终端会话` 模态内部输入控件曾横向撑穿对话框
  - 修复后桌面几何为：
    - dialog：`520px`
    - body：`518px`
    - `Agent 类型` / `工作目录` / `启动新会话`：`470px`

#### 结论

- 对当前这批终端 / 平铺 issue，官方 Tauri MCP 已足以做真实桌面验收，但要接受一个现实：
  - “导航/截图/JS 执行稳定”
  - 不等于
  - “所有高级元素交互工具都稳定”
- 当前最稳的组合是：
  - `manage_window` / `driver_session status` 负责确认实例与窗口
  - `webview_execute_js` 负责 DOM 查询、导航、程序化点击、localStorage 读写
  - `webview_screenshot` 负责视觉证据
  - RT HTTP 负责 PTY / session 真值校验
- 对异步布局回填这类强 timing 问题，不要赌人工点得够快：
  - 应该在页面上下文里人为延迟 `/pty/spawn` 或 `/pty/resume`
  - 让 race condition 变成稳定可复现的桌面验收脚本

#### 可复用操作套路

1. 先确认实例，不要误连或误杀别的端口：
   - 当前用户明确保留的端口可能不属于本轮实例
   - 本轮就要求不要动 `9124`
2. 先做三步最小探活：
   - `driver_session status`
   - `manage_window list`
   - `webview_execute_js(() => location.href)`
3. 如果 `webview_interact` 报 `resolveRef is not a function`：
   - 直接改用 `webview_execute_js`
   - 通过 `document.querySelector(...)`、`Array.from(...).find(...)`、`.click()`、`dispatchEvent(...)` 继续验收
4. 做平铺异步回填验收时：
   - 在页面上下文暂时 patch `window.fetch`
   - 只延迟 `/pty/spawn` 或 `/pty/resume`
   - 在请求返回前程序化切布局
   - 最后读 localStorage 的 `exomind:agentHubTiledState` 做真值判断
5. 做 PTY `waiting_input` 验收时：
   - 用隔离 PTY，不要碰用户自己的 Claude / Codex 会话
   - 先用 RT `spawn` 起一个会保持交互态但会空闲的 shell
   - 再用 `GET /sessions` 看状态转移
   - 唤醒时优先走和前端一致的 PTY input WebSocket
6. 模态 / 对话框类布局 bug，不要只看截图：
   - 同时用 `getBoundingClientRect()` 记录 dialog 与关键控件宽度
   - 本轮这类几何证据比肉眼截图更容易判断“是否真的没越界”

### 阶段补记：#822 无 PTY 会话动作矩阵复核（2026-04-07）

#### 阶段目标

- 复核“没有关联 PTY 的会话”在真实桌面中的收敛入口是否已经补齐。
- 不再只盯着旧卡片 DOM，而是区分：
  - 会话当前是否还处于 `running`
  - 会话是 `structured` 还是 `terminal`
  - 会话是否已经 `completed / archived`
- 验证红色提示横幅是否已经改为“整条可点击关闭”。

#### 观察结果

- 当前桌面实例：
  - 主窗口标题：`ExoMind [dev] [Web:1420 RT:1949]`
  - Tauri MCP bridge：`9223`
- 旧问题卡片 `010659f3-24a6-4f31-be87-94868e3d7588` 的运行时真值是：
  - `interaction_mode = structured`
  - `pty_id = null`
  - `status = completed`
- 这解释了为什么它只显示：
  - `归档`
  - 而不是 `关闭`
- 为避免继续被历史卡片误导，本轮直接在页面上下文创建两个新的活动态 no-PTY 会话：
  - `structured`
  - `terminal`
- 真机 DOM 观察到：
  - `structured + running + no PTY` 显示 `session-card-close-*`
  - `terminal + running + no PTY` 显示 `session-card-force-complete-*`
- 点开 terminal no-PTY 会话后，红色提示横幅现在是：
  - 一个整条 `<button data-testid="agent-runtime-error-banner">`
  - 没有单独的 `agent-runtime-error-banner-dismiss`

#### 结论

- 当前无 PTY 会话动作矩阵已经在真实桌面闭环验证通过：
  - `running + structured + no PTY` → `关闭`
  - `running + terminal + no PTY` → `结束`
  - `completed + no PTY` → `归档`
- 红色提示横幅的交互也已符合预期：
  - 整条可点击
  - 点击后立即消失
  - 不再依赖右上角 `×`
- 本轮还再次验证了动作结果：
  - 点击 `关闭` / `结束` 后，会话状态从 `running` 进入 `completed`
  - 随后卡片动作切换为 `归档`
  - 归档后不再残留活动态 no-PTY 会话

#### 可复用操作套路

1. 先查运行时真值，不要只根据卡片肉眼判断：
   - `GET /sessions`
   - 核对 `status / interaction_mode / pty_id`
2. 若历史卡片都已完成，直接新建临时会话做验收：
   - `POST /sessions` 创建一个 `structured` no-PTY
   - `POST /sessions` 创建一个 `terminal` no-PTY
3. 在桌面里分别检查：
   - `session-card-close-*`
   - `session-card-force-complete-*`
4. 点开 terminal no-PTY 会话后，再核对横幅：
   - 是否为整条 button
   - 是否已经移除单独 dismiss 按钮
5. 验收完成后要把临时会话收敛并归档：

- 先触发 `关闭 / 结束`
  - 再点 `归档`
  - 最后确认 `remainingActiveNoPty = []`

### 阶段补记：#823 API Agent Tab 真机闭环（2026-04-08）

#### 阶段目标

- 在 `网络 / API Agent` 顶部 tab 中完成最小可用真机验收。
- 不只确认 tab 已挂上，还要确认：
  - `天气示例`
  - `发送首轮 / 继续`
  - `继续执行 Tool Results`
  - `读取`
    这些关键按钮都能真实命中 `/agent-sessions`。

#### 观察结果

- 当前桌面实例：
  - 主窗口标题：`ExoMind [feature/api-agent-tab-minimal] [Web:36648 RT:36651]`
  - Tauri MCP bridge：`44451`
- `driver_session start --host 127.0.0.1 --port 44451` 可稳定连通。
- 当前这轮可用的 MCP 能力：
  - `manage_window list`
  - `webview_dom_snapshot`
  - `webview_execute_js`
  - `webview_interact`
- 页面真实可见：
  - `网络` 顶部 `API Agent` tab
  - 请求编排 / 轮次结果 / 工具续跑 / 会话读取 / 调试证据 五块分区

#### 关键发现

- 首版默认把 `recent_events` preset 打开，但后端对这个 preset 有明确约束：
  - `scope_key is required for preset recent_events`
- 结果就是：
  - 页面初次进入后直接点 `发送首轮 / 继续`
  - 会命中 `POST /agent-sessions`
  - 返回 `400`
- 这不是 RT 不可用，也不是按钮没绑好，而是前端默认态和后端约束冲突。

#### 本轮修正结论

- API Agent 实验页要做到“开箱可测”，前端需要：
  - 默认关闭 `recent_events`
  - 当用户手动开启 `recent_events` 且没填 `Scope Key` 时，直接前端禁用发送/续跑并展示提示
- 这样能把“默认 UX 断点”与“后端真实不可用”拆开。

#### 真机闭环链路

1. 起本地 fake provider：
   - `node .tmp/fake-api-agent-provider.mjs`
   - 监听：`127.0.0.1:36701`
2. 给当前 RT 写入最小 provider 配置：
   - `exomind:agentApiProvider=openai`
   - `exomind:agentApiModel=gpt-4o-mini`
   - `exomind:agentApiBaseUrl=http://127.0.0.1:36701`
   - `exomind:agentApiApiKey=stub-key`
3. 在 Tauri 页面点击：
   - `天气示例`
   - `发送首轮 / 继续`
4. 真实观察：
   - `201 /agent-sessions`
   - 页面进入 `needs_tool_calls`
   - 返回 `tool-weather-1 / get_weather`
5. 填入 tool result 后点击：
   - `继续执行 Tool Results`
6. 真实观察：
   - 第二次 `201 /agent-sessions`
   - 页面进入 `completed`
   - 页面显示最终回答
7. 把返回的 `sessionId` 填入读取框，点击：
   - `读取`
8. 真实观察：
   - `200 /agent-sessions/:id`
   - 页面成功回显持久化结果

#### 可复用操作套路

1. API Agent 页先测 RT HTTP，再测桌面按钮，不要反过来。
2. 遇到“按钮点了没反应”，先在页面里 patch `window.fetch`，记录：
   - URL
   - method
   - status
   - response body
3. 对 toggle / 预置按钮，`webview_interact click` 往往比普通 DOM `.click()` 更稳。
4. 需要稳定复现 Agent API 时，优先接本地 fake provider，不要一开始就依赖真实远程模型。

### 阶段补记：#885 RT id 持久化桌面实测（2026-04-09）

#### 阶段目标

- 用真实 `tauri dev` 桌面实例验证 embedded RT 的 `host_id` 是否随实例数据库固定。
- 自动执行：
  - 读取重启前 `runtime_service_status` / `/topology`
  - 停止 RT
  - 重新启动 RT
  - 再次读取 `runtime_service_status` / `/topology`
  - 对照当前实例 `config.sqlite`

#### 观察结果

- 当前受控实例：
  - name: `issue885-tauri`
  - web: `1430`
  - hmr: `1431`
  - embedded RT: `9124`
  - MCP bridge: `9233`
- 官方 `driver_session` 在这轮环境里仍返回 `Transport closed`。
- raw bridge `ws://127.0.0.1:9233` 可稳定执行：
  - `execute_js`
  - `window.__TAURI__.core.invoke('runtime_service_status')`
  - `window.__TAURI__.core.invoke('runtime_service_stop')`
  - `window.__TAURI__.core.invoke('runtime_service_start')`
- 本轮自动重启前后观测到：
  - `runtimeStatusBefore.hostId == runtimeStatusAfter.hostId`
  - `topologyBefore.host_id == topologyAfter.host_id`
  - 值均为：`rt-3b493e5e-b73b-4ea0-8d28-39d1659f1437`
- 当前实例数据库：
  - `.tmp/tauri-dev-state/issue885-tauri/app-data/runtime/config.sqlite`
  - 表：`runtime_config_entries`
  - 记录：
    - `scope=device`
    - `entry_key=exomind:runtimeHostId`
    - `value=rt-3b493e5e-b73b-4ea0-8d28-39d1659f1437`
    - `source=src-tauri:seed-runtime-identity`

#### 结论

- `#885` 在桌面实例实测上成立：
  - embedded RT 的 `host_id` 会跨 RT stop/start 保持不变
  - 且与实例 `config.sqlite` 中的 device-scope 持久化值一致
- 当前 Windows 环境下，要区分：
  - 官方 `driver_session` 失败
  - raw bridge 不可用
- 这次属于前者失败、后者可用；因此仍能完成自动化桌面验收。

#### 可复用操作套路

1. 用 `bun run tauri:manager -- start --name <name> --web-port <port> --hmr-port <port>` 拉起受控实例。
2. 优先读 `.tmp/tauri-dev-state/<name>/app-data/runtime/`，不要误读 `%APPDATA%` legacy shared 路径。
3. 若 `driver_session` 报 `Transport closed`，直接退回 raw bridge：
   - `ws://127.0.0.1:<bridge-port>`
4. 通过 bridge 执行：
   - `runtime_service_status`
   - `runtime_service_stop`
   - `runtime_service_start`
   - 页面上下文 `fetch('http://127.0.0.1:<rt-port>/topology')`
5. 最后读取实例 `config.sqlite`，核对 `runtime_config_entries.entry_key=exomind:runtimeHostId` 与 `/topology.host_id` 是否一致。

### 阶段补记：#780 时间块统一桌面叙事实测（2026-04-09）

#### 阶段目标

- 用真实 `tauri dev` 外心实例验证 `#780` 的统一时间块结构，重点不是再看单测，而是确认桌面 UI、RT 路由和持久化在用户叙事上没有割裂。
- 本轮优先跑：
  - 叙事 1：从空闲开始新的 active 时间块
  - 叙事 2：pause -> resume
  - 叙事 3：stop -> feedback_submit -> gap
  - 叙事 4：gap / terminal active 不阻塞下一块开始
  - 叙事 6：reload / RT 重启后的恢复

#### 观察结果

- 当前受控实例：
  - name: `issue780-tb`
  - web: `1444`
  - hmr: `1445`
  - embedded RT: `1954`
  - raw bridge: `9247`
- 官方 `driver_session` 在当前环境里仍返回 `Transport closed`，但 raw bridge `ws://127.0.0.1:9247` 可稳定执行：
  - `list_windows`
  - `execute_js`
- 当前主窗口真实 URL：
  - `http://localhost:1444/eventlog`
- 页面上下文直接 `fetch('http://127.0.0.1:1954/timeblocks/active')` 会返回 `200`，但要带：
  - `?user_id=<current-profile-or-anonymous>`
- 裸 `curl http://127.0.0.1:1954/timeblocks/active` 现场返回过 `401`；
  - 对时间块桌面验收，不要把这类裸请求直接当成产品行为真相。
- 本轮现场先观察到一个 legacy terminal active：
  - `phase=feedback_submitted`
  - `transitions=[]`
  - 但桌面 UI 没把它继续渲染成 running 卡片
- 从桌面配置态点击开始后，RT 正确把这个 terminal active 收敛为 completed，并创建新 active：
  - completed 补上 `transitions=[end]`
  - 新 active 以 `transitions=[start]` 起步
- pause / resume 实测结果：
  - RT `phase` 与 UI 按钮文案同步切换
  - `transitions` 追加 `pause` / `resume`
- stop / feedback_submit 实测结果：
  - RT 先进入 `feedback_in_progress`
  - 完成提交后，当前 active 变为 `blockType=gap`
  - 已完成块保留：
    - `start`
    - `pause`
    - `resume`
    - `feedback_start`
    - `feedback_submit`
    - `end`
- 从 gap 再开始下一块时，桌面 UI 未被误阻塞：
  - gap 先以 completed 形式落库
  - 新 active 正常创建
- 持久化旁证：
  - `.tmp/tauri-dev-state/issue780-tb/app-data/runtime/timeblocks.sqlite`
  - 当前库内已可直接看到：
    - active 行：`payload_json.transitions=[start]`
    - gap 行：`transitions_json=[start,end]`
    - completed 行：含 `feedback_start / feedback_submit / end`
- reload 后恢复通过：
  - 同一个 `startId` 的 active block 被桌面 UI 正确恢复
- RT stop/start 后恢复通过，但自动脚本本身曾超时：
  - `runtime_service_status.startedAt` 发生变化，说明 RT 确实重启
  - 重启后同一个 `startId` 的 active block 重新从 RT 与桌面 UI 同步恢复
  - 这轮阻塞点在 bridge 脚本等待时序，不在时间块语义本身

#### 结论

- `#780` 本轮桌面叙事主链可判定通过：
  - terminal active 不再阻塞开始新块
  - pause / resume / feedback / gap 都能由 `transitions` 派生出一致语义
  - reload / RT 重启后，没有把 completed / gap 重新误认成 running active
- 当前仍未在桌面 UI 上补跑的只剩：
  - Today Planner 入口叙事（`sourcePlannedBlockId`）
- 因此这轮更像：
  - 时间块统一主链通过
  - planner provenance 叙事待补

#### 可复用操作套路

1. 先用 raw bridge 确认主窗口 route 和时间块 testid：
   - `new-focus-idle-card`
   - `new-focus-start-button`
   - `new-focus-pause-resume-button`
   - `new-focus-end-button`
   - `new-focus-feedback-confirm`
2. 页面上下文取 RT 证据时，统一走：
   - `fetch('http://127.0.0.1:<rt-port>/<path>?user_id=<scope>')`
3. 不要只看 DOM：
   - 同步抓 `/timeblocks/active`
   - `/timeblocks`
   - 必要时补 `timeblocks.sqlite`
4. 验证 terminal active 替换时，重点比对三件事：
   - 旧 active 是否被收敛进 completed
   - 新 active 是否以 `transitions=[start]` 起步
   - UI 是否没有继续显示旧 running 卡片
5. 验证 gap 不阻塞时，重点比对：
   - 提交反馈后 active 是否变成 `blockType=gap`
   - 再次开始时是否直接切回新 active
6. 验证恢复性时，允许把“bridge 脚本等待超时”和“产品状态恢复失败”分开判断：
   - 前者属于工具时序噪音
   - 后者才属于时间块统一回归
