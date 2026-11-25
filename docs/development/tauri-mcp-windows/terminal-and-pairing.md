# 终端、会话与双实例配对

[返回《Tauri MCP Windows Playbook》](../tauri-mcp-windows-playbook.md)

## 当前阶段：#806 / #810 终端生命周期联调

更新时间：`2026-04-02`

### 阶段补记：Agent Hub 终端状态分层实测（2026-04-11）

#### 本轮阶段目标

- 验证 Agent Hub 终端状态分层改动已经真正落到桌面窗口，而不是只停留在单测：
  - `SessionCard` 顶部把 `Claude · 刚刚` 收敛到左侧状态簇
  - `TiledGrid` pane header 左上显示状态图标 + `Claude · 刚刚`
  - pane footer 左下优先显示 `等待输入`
  - PTY 非阻塞展示态可切到：
    - `输出重连中，输入暂停`
    - `输入只读，可重连`
    - 右侧动作 `重连输入`
- 清掉旧的无效测试 session，尽量用新建终端而不是历史脏数据做验收。

#### 本轮观察结果

- 官方 `driver_session` 在当前 Windows 现场仍直接报：
  - `Transport closed`
- raw bridge `ws://127.0.0.1:9223` 可稳定工作，且本轮足以完成真实验收。
- 新开的隔离实例里残留了一批旧测试 session（例如 `sid-123`、`sid-message-only`、`tmcp-missing-pty-*`）。
  - 这些脏数据可直接通过页面现有 `close / archive` 按钮清掉
  - 不必为了“清现场”绕过产品逻辑直接删库
- 通过页面自身 `pty-spawn-button -> 创建新终端` 成功新建了全新终端：
  - 先验证了 `Claude` 新终端可直接创建
  - `SessionCard` 元信息为 `Claude·刚刚`
  - `TiledGrid` pane footer 默认回到 `等待输入`
- `waiting_input` 的左上状态图标已在真实桌面窗口中切换为：
  - `lucide-hand`
  - 不再是告警三角
- 真实窗口里：
  - `SessionCard` 已无右上角独立时间块
  - `SessionCard` 内也无 clock icon 残留
  - `TiledGrid` pane meta 位于左侧状态簇，动作按钮仍在右侧
- 单靠 `runtime_service_stop()` 去抓瞬时 footer 态不稳定：
  - 现场更容易触发 pane 替换 / 会话切换
  - 不适合做“非阻塞 presentation 文案”的精确验收
- 更稳的做法是：
  - 从真实 pane DOM 节点拿到 `__reactFiber$*`
  - 找到 `PtyTerminal` function component fiber
  - 直接调用其 `memoizedProps.onTransportPresentationChange(...)`
- 本轮用这条路径在真实桌面窗口里确认了：
  - footer 可切到 `输出重连中，输入暂停`
  - footer 可切到 `输入只读，可重连`
  - 右侧会出现 `重连输入`
  - 点击 `重连输入` 后，footer 可回到 `等待输入`

#### 本轮结论

- 这轮终端状态分层改动已经通过真实 Tauri 桌面窗口验证，不只是测试桩层通过。
- 对“展示层状态文案 / 右侧动作是否正确”的验收：
  - raw bridge + React fiber 注入，比 stop/start RT 更稳、更精确
- 对“清理无效会话再新建终端”的诉求：
  - 先用页面现有 close/archive 收敛旧 session
  - 再用新建终端建立最小干净测试态
  - 是当前最可靠的桌面验收顺序

#### 可复用操作套路

1. 先尝试官方 `driver_session`；若仍是 `Transport closed`，直接切 raw bridge，不要卡住。
2. 打开 `/agents` 后，先清理旧测试 session：
   - 用页面现有 `session-card-close-*`
   - 再点 `session-card-archive-*`
3. 用 `pty-spawn-button` 新建一个全新终端，优先不要复用历史脏会话。
4. 先验证静态展示层：
   - `SessionCard` 的 `session-card-meta-*`
   - `TiledGrid` 的 `tiled-grid-pane-meta-*`
   - `tiled-grid-footer-status-*`
5. 若要精确验证 PTY 非阻塞状态，不优先 stop/start RT。
   - 先从 pane 内容节点取 `__reactFiber$*`
   - 向下找到 `PtyTerminal`
   - 直接调用 `memoizedProps.onTransportPresentationChange(...)`
6. 验证输入只读恢复链时：
   - 先注入 `input-readonly`
   - 再点 `tiled-grid-retry-input-*`
   - 最后确认 footer 回到 `等待输入`

### 阶段补记：Agent Hub 可选模型对话框真窗验收（2026-04-11）

#### 本轮阶段目标

- 在真实 Tauri 窗口里确认 Agent Hub 的 PTY 创建/恢复对话框已经收敛到新的“可选模型”契约：
  - 创建 Claude 时，模型与额外参数占位符都只是示例，不暗示默认值
  - 关闭再打开后，Claude 的模型草稿仍保留
  - 创建 Codex 时，模型占位符为示例格式，推理强度仅在创建模式出现
  - 恢复已有终端时，不再出现模型/推理强度控件
- 本轮明确复用现有窗口，不额外新开 Tauri dev 实例

#### 本轮观察结果

- 官方 `driver_session` 依旧直接报：
  - `Transport closed`
- 现有窗口对应端口仍存活：
  - Web `1420`
  - RT `9124`
  - bridge `9223`
- raw bridge 仍可稳定复用到当前窗口，无需重启 app。
- 对话框按钮在真实窗口里，单纯 `HTMLElement.click()` 不够稳。
  - 更可靠的方式是派发完整序列：
    - `pointerdown`
    - `mousedown`
    - `pointerup`
    - `mouseup`
    - `click`
- React 受控输入在真窗里不能只靠 `el.value = ...` 再派发事件来改值。
  - 直接赋值只会改 DOM，不一定进 React state
  - 要使用：
    - `HTMLInputElement.prototype.value` 的原生 setter
    - 再补 `input` / `change` 事件
- 本轮实测读取到的真实 UI 状态：
  - 创建 Claude：
    - `pty-model.placeholder = 例如：claude-sonnet-4-5`
    - `pty-extra-args.placeholder = 例如：--search --full-auto`
  - 使用原生 setter 写入 Claude 模型草稿后，关闭再打开：
    - `pty-model.value = claude-react-setter-verify`
  - 创建 Codex：
    - `pty-model.placeholder = 例如：gpt-5.4`
    - `pty-reasoning-effort` 可见
  - 恢复已有终端（切到 Codex）：
    - `pty-model` 不可见
    - `pty-reasoning-effort` 不可见
    - 说明文案为：
      - `恢复已有终端时将沿用历史会话自身路径与模型配置，无需重新填写工作目录或模型。`

#### 本轮结论

- 可选模型对话框的关键 UX 已在真实 Tauri 窗口中验证通过。
- “对话框关闭后草稿是否真的保留”这类问题，真窗验证必须注意 React 受控输入写入方式；否则容易把 automation 自己的写值方式误判成产品 bug。
- 本轮不需要新建额外窗口；复用现有 `1420/9124/9223` 实例即可完成验收。

#### 可复用操作套路

1. 先检查 `1420 / 9124 / 9223` 是否仍在监听，再决定是否复用当前窗口。
2. 若官方 `driver_session` 仍是 `Transport closed`，直接切 raw bridge，不在官方会话上反复重试。
3. 对真实按钮交互优先派发完整 pointer/mouse 序列，不假设裸 `click()` 足够。
4. 对 React 受控输入必须用原生 setter：
   - `Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set`
   - 再补 `input` / `change`
5. 真窗验收该类表单时，至少覆盖：
   - 创建态示例占位符
   - 关闭再打开后的草稿保留
   - 恢复态的控件隐藏

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
- 确认“会话页 / 提案箱页卡死、无日志、活跃卡点击无响应”的旧坏态已经消失。

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
  - 提案箱页可加载，不再停留在“提案箱加载中...”
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
  - `/proposals` 可进入提案箱页面，不再卡在 `提案箱加载中...`

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
