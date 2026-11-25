# 任务图、设备、同步与实例收束

[返回《Tauri MCP Windows Playbook》](../tauri-mcp-windows-playbook.md)

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

### 阶段补记：#868 / #869 同步边界双实例实测（2026-04-11）

#### 阶段目标

- 用真实双实例桌面环境验证四大系统的同步边界，而不是只停留在 happy-path：
  - EventLog
  - TimeBlock
  - Task
  - Proposal
- 本轮重点观察三类边界：
  - 恢复性同步
  - 冲突合并
  - 分叉后的重收敛

#### 观察结果

- 官方 `driver_session` 在本轮环境里仍然不可用：
  - 返回 `Transport closed`
- 当前可工作的桌面验收路径仍然是：
  - raw bridge + RT HTTP + 页面上下文 `execute_js`
- 本轮受控双实例真值：
  - A: Web `1480`, raw bridge `9283`, embedded RT `9160`
  - B: Web `1484`, raw bridge `9287`, embedded RT `9164`
- 当前桌面窗口的真实 scope 不是 profile scope，而是：
  - `localStorage['exomind:profile-session'] === null`
  - effective UI scope = `anonymous`
- 主报告路径：
  - `.tmp/reports/tauri-sync-boundary/2026-04-11T02-10-19-928Z/report.md`
  - `.tmp/reports/tauri-sync-boundary/2026-04-11T02-10-19-928Z/report.json`
- 已确认的强通过项：
  - task recovery UI
  - timeblock recovery RT
  - task terminal conflict -> `cancelled`
  - timeblock phase conflict -> `feedback_in_progress`
  - eventlog fork union
  - task fork union
- 已确认的强失败项：
  - eventlog same-id conflict 在重连后仍各保留各自内容，没有自动重收敛
  - proposal status/comment conflict 会丢失较早的 status 更新，最终收敛到较晚 comment 分支
- 已确认的部分/非确定项：
  - eventlog recovery 在 RT truth 上恢复成功，但当前 `/eventlog` 页面 DOM probe 未在观察窗口内看到 marker
  - proposal recovery 在 RT truth 上恢复成功，但 inbox 可见性不是 signal-driven，而是带明显 polling 时序

#### 结论

- 在 Windows 下，官方 `driver_session` 失败不等于这轮桌面验收无法继续。
  - 需要先区分：
    - 官方 driver 失败
    - raw bridge 失败
  - 本轮属于前者失败、后者可用
- 对同步边界验证，必须把：
  - RT truth
  - UI truth
  分开记录，不能只凭其中一层下结论。
- Proposal 当前最危险的不是“完全不同步”，而是：
  - RT 已经同步
  - 但前端 inbox 仍以 polling 为主
  - 导致恢复性观察具有时序噪音，容易把“延迟出现”误判成“必须手动刷新”
- EventLog 当前最明确的未闭环问题是：
  - same-id divergent content 没有明确定义或实现自动重收敛契约
- Proposal 当前最明确的未闭环问题是：
  - status 更新会被后到的 comment 分支覆盖，产生真实数据丢失

#### 可复用操作套路

1. 先确认当前实例真值，不要直接套用历史端口：
   - Web
   - raw bridge
   - embedded RT
2. 如果 `driver_session` 报 `Transport closed`，直接切 raw bridge，不要卡住：
   - 页面上下文 `execute_js`
   - 页面内 `fetch('http://127.0.0.1:<rt-port>/...')`
3. 先读页面作用域，再决定用哪个 scope 做验证：
   - 当前真实桌面 UI scope 用 `anonymous`
   - 需要避免污染现网 UI 时，用 synthetic scope 做 RT-only conflict/fork 测试
4. 做 Proposal 验证时，先记住 inbox 不是即时 signal-driven：
   - `src/ui/app/pages/proposals/ProposalInboxPage.tsx`
   - `POLL_INTERVAL_MS = 30_000`
   - 因此“看到了延迟出现”与“必须手动刷新”不是一回事
5. 做 EventLog / Proposal 的边界报告时，至少分三层写清：
   - 写入前 truth
   - 重连后 RT truth
   - 重连后 UI visibility
6. 若主报告脚本失败，不要把脚本 bug 当产品 bug：
   - 本轮 `fork_eventlog_union` 首报失败是脚本里的 `poll` 初始化错误
   - 单独补跑后应重新归类产品结论

### 阶段补记：#901 / #875 / #878 推送后桌面 smoke（2026-04-11）

#### 阶段目标

- 在代码已提交并推送到 `dev` 后，用真实桌面实例验证这轮改动，而不是只停留在 `vitest + tsc`。
- 重点覆盖：
  - `#901` 平铺空槽位创建终端时，主反馈是否回到目标槽位
  - `#875` 平铺工作台快捷键是否已收口到「终端 Agent」
  - `#878` 连接区主标签是否已切到用户语义

#### 观察结果

- 官方 `tauri_mcp_server` 在本轮环境里仍不可用：
  - `driver_session`
  - `get_setup_instructions`
  均直接报 `Transport closed`
- raw bridge 仍然可正常工作，可直接连现成桌面实例：
  - `ws://127.0.0.1:9287`
  - 对应窗口：`ExoMind [dev] [Web:1484 RT:9164]`
- 现成实例的 bridge 端口可由 `webPort` 直接推导：
  - 公式：`9223 + (webPort - 1420)`
  - 例：
    - `web-1480` => `9283`
    - `web-1484` => `9287`
- 尝试重新拉起 `web-1420 / rt-9124` 新实例时，Rust 构建在链接阶段中断：
  - `link.exe` 返回 `0xc000013a`
  - `ring` build script 随后失败
  - 结论：当前机器上已有可用桌面实例时，优先复用现成实例比强拉新实例更稳

#### 本轮已验证的产品结论

- `#875` 桌面设置页已看到真实结果：
  - 「终端 Agent」分区中出现：
    - `平铺工作台方向快捷键`
    - `平铺工作台命令快捷键`
    - `平铺工作台单次透传快捷键`
- `#878` 本轮最小范围已在桌面设置页看到真实结果：
  - 「连接」分区主标签显示为：
    - `连接方式`
    - `本机开放范围`
- `#901` 真实创建链路通过 smoke：
  - 在 `网络 / 平铺` 里，从空槽位点击 `新建终端`
  - 选择 `pty-mode-create`
  - 点击 `启动新会话`
  - 立即观察到：
    - 创建弹窗关闭
    - 原始 `slot-1` 切换成 `创建中 / 正在创建终端`
  - 约 10 秒后：
    - 同一槽位切换为真实 Claude 终端画面

#### 可复用操作套路

1. 先锁定现成实例真值，不要先假设 `1420 / 9124 / 9223`
   - `Get-Process exomind`
   - `Get-NetTCPConnection`
2. 如果官方 `driver_session` 直接 `Transport closed`
   - 不要继续卡在官方 driver
   - 直接退到 raw bridge
3. raw bridge 最小客户端只需要两个命令：
   - `list_windows`
   - `execute_js`
4. 设置页验收优先抓稳定 selector：
   - `new-settings-desktop-vc-section-connection`
   - `new-settings-desktop-vc-section-terminal-agent`
5. 平铺终端验收优先抓稳定 selector：
   - `agent-view-toggle-tiled`
   - `tiled-slot-slot-1`
   - `pty-mode-create`
6. 若字符串匹配出现异常，不要先怀疑产品逻辑：
   - 先看 `outerHTML`
   - 先看 `data-testid`
   - 先看 button 顺序
   - 当前环境里，部分按钮文本会被字体或隐藏字符干扰，直接按 `data-testid` 或索引更稳

### 阶段补记：#828 / #896 残留进程现场收敛（2026-04-13）

#### 本轮抓到的真实残留

- `#896` 的桌面自动化验证结束后，`tauri:manager` 记录已清掉，但现场仍残留：
  - raw bridge：`0.0.0.0:9293`
  - embedded RT 实际端口：`0.0.0.0:65072`
- 当时对应的 Web 端口 `1490` 已经不通，说明不是一个“完整可用实例”，而是一条半死不活的残留链。
- 连接表显示两个监听都属于 `PID 4920`，但：
  - `tasklist`
  - `Get-Process`
  - `wmic process`
    都查不到 `4920` 本体。
- 继续顺着进程树查，能找到两个仍存活的子进程：
  - `bun run packages/ts-agent-cli/agents/reviewer/index.ts`
  - `bun run packages/ts-agent-cli/agents/classifier/index.ts`
- 把这两个 `bun` 子进程及其 `conhost` 一起 `taskkill /T /F` 后：
  - `9293` 释放
  - `65072` 释放
  - 两个端口都能重新绑定

#### 根因收敛

- 当前桌面主窗口关闭链路在 [src-tauri/src/lib.rs](../../../src-tauri/src/lib.rs) 里仍存在：
  - `WindowEvent::Destroyed`
  - 直接 `std::process::exit(0)`
- 这条路径会绕开 `runtime_service_stop -> ensure_runtime_stopped -> runtime.stop().await` 的正常停机链路。
- embedded runtime 的正常停机链路在 [src-tauri/src/commands/runtime_commands.rs](../../../src-tauri/src/commands/runtime_commands.rs) 与 [crates/exomind-runtime/src/lib.rs](../../../crates/exomind-runtime/src/lib.rs) 里会显式：
  - 停 server task
  - 停 tick / actor task
  - kill 并 wait 默认 TS agents
  - 关闭 PTY / mDNS / mesh relay
- 但窗口销毁时直接 `process::exit(0)`，就容易把：
  - embedded RT
  - raw bridge
  - 默认 TS agents
    留在后台。
- `tauri:manager` 当前健康探测与清理重点仍是：
  - root pid
  - web port
  - hmr port
  - app pid
- 它还没有把下面这些也当作实例真值的一部分：
  - actual runtime port
  - raw bridge port
  - 默认 TS agent 子进程
- 所以会出现“manager 看起来停了，但现场其实没停干净”的假象。

#### 防范经验

1. 在修复落地前，不要把点主窗口 `X` 当成正常收尾。
2. 结束受管实例时，优先使用：
   - `bun tauri:manager stop --name <instance>`
3. 对 `9124` 这类默认 RT 端口，不要先假设“被占用就是产品 bug”：
   - 先判断是不是健康 ExoMind 实例
   - 再判断是不是残留 runtime / bridge / agent
4. 对 Windows Tauri 现场，必须把：
   - manager 真值
   - socket 真值
   - 协议真值
   三层交叉验证，不要只看其中一层。

#### 检测经验

1. 先看 manager 视角：
   - `bun tauri:manager list`
2. 再看 socket 视角：
   - `Get-NetTCPConnection -State Listen`
   - 不要只查 Web / HMR；还要同时看：
     - actual RT port
     - raw bridge port
3. 再看协议真值：
   - runtime：`Invoke-WebRequest http://127.0.0.1:<rt-port>/health`
   - raw bridge：不要只看 TCP 能否建立；至少还要跑一条最小命令
     - `list_windows`
     - 或 `execute_js`
4. 若出现下面这种组合，要优先怀疑“孤儿监听 / 半死实例”：
   - TCP 能连
   - 但 raw bridge 指令超时
   - Web 已经不通
   - `/health` 也不健康
5. 若连接表里还能看到 owner pid，但系统查不到该 pid 本体：
   - 继续查 `ParentProcessId = <ownerPid>` 的存活子进程
   - 特别关注：
     - `packages/ts-agent-cli/agents/reviewer/index.ts`
     - `packages/ts-agent-cli/agents/classifier/index.ts`

#### 清理顺序

1. 先走正常链路：
   - `bun tauri:manager stop --name <instance>`
2. 复核端口是否真的释放：
   - Web
   - HMR
   - actual RT
   - raw bridge
3. 如果还有监听，再做协议探测：
   - runtime `/health`
   - raw bridge 最小命令
4. 如果 owner pid 已不可枚举，但能找到残留子进程：
   - 对残留子进程执行 `taskkill /PID <pid> /T /F`
5. 最后用“可重新绑定”做终态验证，而不是只看 `Get-NetTCPConnection` 一次输出。

#### 这轮明确收住的判断框架

- 不要只问“端口还在不在”。
- 要同时问三件事：
  - 这个实例是否还被 manager 正确认知
  - 这个 socket 是否还真的被占用
  - 这个协议端点是否还真能正常响应
- 只看其中一层，很容易把：
  - bridge 半死
  - runtime 假活
  - 孤儿 agent 子进程
    误判成“产品逻辑回归”。

### 阶段补记：受管健康实例的干净关闭方法（2026-04-14）

#### 适用前提

- 当前实例仍是 `tauri:manager` 能正常识别的健康实例，不是上一节那种“manager 已丢、只剩孤儿监听”的半死链。
- 目标是把一轮真实桌面验收用到的 ExoMind app 实例完整收口，而不是只把窗口点掉。

#### 本轮收敛出的判断

- 对健康实例，优先走：
  - `bun run tauri:manager stop --name <instance>`
  - 或等价的：
    - `bun scripts/dev/tauri-dev-manager.ts stop --name <instance>`
- 但不能因为命令返回了 `stopped:` 就直接判定“已经关干净”。
- 必须把下面四层一起验证通过，才算实例真的停了：
  - manager 视角：实例不再出现在 `list`
  - socket 视角：`Web / HMR / RT / bridge` 端口都不再监听
  - 进程视角：`exomind.exe` 与该实例目录下派生的 `msedgewebview2.exe` 子进程都不存在
  - 连通性视角：`Web`、`RT /health`、`bridge TCP` 都不可达

#### 推荐关停顺序

1. 先列出当前受管实例，不要凭窗口标题或历史记忆下手：
   - `bun run tauri:manager list`
2. 记下这轮目标实例真值：
   - `name`
   - `web`
   - `hmr`
   - `rt`
   - `bridge`
3. 对目标实例逐个执行：
   - `bun run tauri:manager stop --name <instance>`
4. 关闭后立刻做四重复核：
   - `bun run tauri:manager list`
   - `Get-NetTCPConnection -State Listen`
   - `Get-CimInstance Win32_Process`
   - `Invoke-WebRequest` / TCP connect
5. 只有四层都收敛到“不可用”后，才把这套实例记为已关闭。

#### 四重复核的最小命令模板

```powershell
# 1) manager 视角
bun run tauri:manager list

# 2) socket 视角
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in @(<web>, <hmr>, <rt>, <bridge>) }

# 3) 进程视角
Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -eq 'exomind.exe') -or
    ($_.CommandLine -match '<instance>|\\.tmp\\\\tauri-dev-state\\\\<instance>')
  } |
  Select-Object ProcessId, Name, CommandLine

# 4a) Web / RT 连通性
Invoke-WebRequest http://127.0.0.1:<web>/ -TimeoutSec 2 -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:<rt>/health -TimeoutSec 2 -UseBasicParsing

# 4b) bridge / HMR TCP 连通性
# PowerShell 用 TcpClient 做 1s 左右的 connect 探测即可
```

#### 验收口径

- “窗口没了”不等于实例停了。
- “`stop --name` 返回成功”不等于实例停了。
- 只有当下面四条同时成立时，才可下结论说“关干净了”：
  - `list` 里不再有该实例
  - `Web / HMR / RT / bridge` 对应端口全部释放
  - 对应 `exomind.exe` 与实例目录下的 WebView 子进程全部消失
  - `Web`、`RT /health`、`bridge TCP` 全部不可达

#### 明确不要这样做

- 不要直接：
  - `taskkill /IM exomind.exe /F`
  - `taskkill /IM msedgewebview2.exe /F`
- 这类全局杀法会把别的桌面实例、别的验证现场，甚至别的非 ExoMind WebView 一起带掉。
- 任何脚本、Agent 或手工清理都不得按镜像名终止 `exomind.exe` / `msedgewebview2.exe`。
- 端口监听 PID 不能单独作为 ownership。只有根 PID 的创建时间/可执行路径匹配记录，或进程命令行明确落在该实例 `targetDir` 且属于其已确认进程链时，才允许终止。
- `taskkill /PID <pid> /T /F` 也只能用于上述已确认 PID；PID 不存在或身份不匹配时停手并保留现场，不要扩大为全进程匹配。
- 只有当：
  - manager 已失真
  - 正常 `stop --name` 已经失效
  - 且已确认存在孤儿监听 / 残留子进程
    时，才退回上一节的残留清理路径。

#### 与上一节的边界

- 本节解决的是：
  - “健康、受管实例如何正常收口”
- 上一节解决的是：
  - “manager 已经丢实例，但现场还残留半死链时怎么追杀”
- 现场判断时，先走本节；只有发现：
  - manager 视角为空
  - 但 socket / 协议仍活着
    才切回上一节的孤儿清理流程。
