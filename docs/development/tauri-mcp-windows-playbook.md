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
