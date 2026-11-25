# 终端恢复与会话所有者

[返回《Tauri MCP Windows Playbook》](../tauri-mcp-windows-playbook.md)

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
- 顺带确认 `提案箱` 不再停在“提案箱加载中...”。

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
- 切到 `提案箱` 页后：
  - 页面正常进入并渲染统计卡与筛选按钮
  - 未再停在 `提案箱加载中...`
  - 本轮现场为零提案空状态，但页面可用

#### 结论

- 这轮现场里，“界面卡住 / 提案箱加载中”在 `taskkill bun/node/cargo` 后恢复，进一步坐实：
  - 残留进程占住 `9124` 属于独立环境层问题，应该继续放在 `#828` 跟踪
  - 它会把 `#806 / #824` 的前端表现伪装成“页面卡死”或“Terminal 没反应”
- 在清掉残留进程后，当前实现分支上的 `#806 / #824` 主链路已经能在 Tauri MCP 真窗里通过：
  - 活跃会话数 `< 5`
  - UI 与 RT 过滤口径一致
  - 点击 live 会话可打开 Terminal
  - 点击 stale/completed 会话会明确失败并留下 trace
  - 提案箱可正常加载
- 因此后续排查必须先区分：
  - `#828` 环境层：端口占用 / embedded RT 自启动失败 / bridge 异常
  - `#806 / #824` 产品层：会话生命周期、Terminal 打开、失败反馈、提案箱加载

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
4. 如果用户说“提案箱加载中...”：
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
