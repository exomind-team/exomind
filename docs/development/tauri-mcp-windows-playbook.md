# Tauri MCP Windows Playbook

> 持续更新。用于沉淀在 Windows 环境下，使用 Tauri MCP 调试 ExoMind 外心桌面应用的实践经验、坑点与验证套路。

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
  - `EventSource('http://127.0.0.1:9124/pty/<pty_id>/stream')`
  - 对 `output` 事件做 base64 解码后，确认包含 marker：
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
3. 需要验证 transcript 是否真的可回放时，直接在页面里建 `EventSource`
   - 收 `output` / `eof`
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
- 同时沉淀一套 raw bridge + 页面内 `fetch`/`EventSource` 的最小可复用验收套路

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
- 向 PTY 发输入时，页面内请求体必须是：
  - `POST /pty/:id/input`
  - `{ "data": "<base64>" }`
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
3. 需要验证 transcript 时，直接在页面里建 `EventSource('/pty/:id/stream')`
4. 收到 `output` 事件后做 base64 解码，再断言 marker 文本
5. 需要确认按钮逻辑是否真正命中 React 时，优先取 DOM 上的 `__reactProps$*` 并直接调 `onClick(...)`

#### 对后续 Agent 的直接提醒

- 不要假设 Claude spawn 后立刻就能从 `/pty/sessions?agent_type=claude` 查到历史 session
- 不要把 `button.click()` 是否生效，直接等同于“产品逻辑是否正确触发”
- 不要在断线恢复场景里只看 UI；至少同时看：
  - `/sessions`
  - `/pty`
  - `localStorage['exomind:agentHubTiledState']`
  - `/pty/:id/stream` 的 transcript 内容

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

## 持续更新约定

- 每完成一个 Tauri MCP 阶段目标，就在本文档追加：
  - 阶段目标
  - 观察结果
  - 结论
  - 对后续 Agent 有复用价值的操作套路
- 不另建新的临时“排查总结”文档，避免经验碎片化。
