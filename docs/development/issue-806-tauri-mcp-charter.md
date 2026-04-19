# #806 Tauri MCP Charter

> 目的：把 `#806` 及其衍生 issue 的用户故事，转换为一套可重复执行的桌面端自动交互章程，并且能在当前 `tauri:manager` 实例上直接产出证据。

## 覆盖范围

- `#806` 终端 PTY Agent 会话生命周期正常化
- `#822` 所有按钮点击必须按场景提供可追溯反馈
- `#824` 会话页活跃数需与 RT 一致，且会话卡片进入 Terminal 必须成功或明确失败
- `#828` Windows 下 `bun run tauri dev` 残留进程会伪装成页面假加载，章程需能区分环境故障与业务故障

## 当前执行入口

```bash
bun run tauri:charter:issue806 -- --name <instance>
```

示例：

```bash
bun run tauri:charter:issue806 -- --name issue806-g
```

默认输出：

- JSON: `.tmp/reports/tauri-mcp-issue806-charter/<timestamp>-<instance>.json`
- Markdown: `.tmp/reports/tauri-mcp-issue806-charter/<timestamp>-<instance>.md`

## 为什么使用 raw bridge

截至 `2026-04-03`，当前 Windows 现场里官方 Tauri MCP `driver_session` 仍可能返回 `Transport closed`，但底层 `tauri-plugin-mcp-bridge` 的 WebSocket raw bridge 可稳定响应：

- `list_windows`
- `execute_js`

因此本章程采用以下降级原则：

1. 优先使用 `tauri:manager` 保证当前实例可定位、端口可追踪。
2. 如果官方 MCP transport 失效，则退回 raw bridge。
3. 继续在真实桌面实例上执行，而不是退回纯 Web 假环境。

这仍然是 Tauri MCP 链路的一部分，只是绕过了当前不稳定的高层封装。

## 章程步骤

### 1. 选定当前桌面实例

- 从 `.tmp/tauri-dev-instances/*.json` 读取 `tauri:manager` 实例元数据。
- 优先选择 `rootPid` 仍存活的实例。
- 如有多个运行中的实例，必须显式传 `--name`。

### 2. 推导 raw bridge 与 RT 真值源

- Web 端口来自实例记录中的 `webPort`
- raw bridge 端口按当前本地约定推导：
  - `bridgePort = 9223 + (webPort - 1420)`
- RT SQLite 真值源：
  - `.tmp/tauri-dev-state/<instance>/app-data/runtime/sessions.sqlite`

### 3. 进入 `/agents` 并切到 `会话`

- 导航到 `/agents`
- 等待 `agent-view-toggle-sessions`
- 点击后等待：
  - `sessions-view` 或
  - `sessions-empty-state`

### 4. 用 UI 与 RT SQLite 做会话对账

UI 统计规则必须与 `SessionsView.tsx` 完全一致：

- `visible = status !== 'archived'`
- `active = visible && status !== 'completed'`
- `completed = status === 'completed'`

断言：

1. `active < 5`
2. UI `active/completed/total` 与 RT SQLite 汇总一致
3. UI visible session ids 与 RT visible ids 一致

### 5. 校验会话卡片进入 Terminal 的行为

对每个活跃卡片：

1. 点击 `session-card-<id>`
2. 断言右侧至少出现一种结果：
   - 实时 Terminal 容器可见
   - 断开/失败视图可见
3. 如果进入断开/失败视图：
   - 必须有明确失败消息
4. Webview console 必须出现可追溯日志：
   - 至少匹配 `[agent-hub][pty][open]`

对至少一个已完成卡片：

1. 点击 `session-card-<id>`
2. 断言右侧进入断开历史视图
3. 断言失败消息可见
4. 断言 console trace 存在

这一步直接对应 `#822` 与 `#824` 的“有反馈、可追溯、不可无响应卡住”。

### 6. 校验 `/proposals`

- 导航到 `/proposals`
- 等待 `proposal-inbox-page`
- 断言页面不再停在 `提案箱加载中...`

允许的通过结果：

- 正常显示提案列表/空态
- 正常显示非 loading 的失败态

不允许的结果：

- 一直卡在 loading

### 7. 产出证据

脚本必须输出：

- 当前实例名、web port、bridge port
- UI 与 RT 会话汇总
- mismatch 列表
- 每个会话卡片点击后的 UI 结果与 console entries
- `/proposals` 当前状态
- 总体 PASS / FAIL

## 当前已验证现场

执行时间：`2026-04-03`

实例：`issue806-g`

命令：

```bash
bun run tauri:charter:issue806 -- --name issue806-g
```

结果：

- PASS
- UI active/completed/total: `0/1/1`
- RT active/completed/total: `0/1/1`
- 已完成会话点击后：
  - 右侧进入断开历史视图
  - UI 显示 `Terminal 已断开，无法恢复；下方将展示关闭前历史，可结束后归档。`
  - console 出现 `[agent-hub][pty][open] ...` trace
- `/proposals` 成功进入提案箱页面，未卡在 loading

## 使用建议

- 先跑此章程，再决定是否继续查业务逻辑。
- 如果章程失败，先看失败属于哪一层：
  - 实例未启动 / raw bridge 不通
  - UI 与 SQLite 真值不一致
  - 会话卡片点击无反馈或无 trace
  - 提案箱卡 loading
- 如果 `driver_session` 再次恢复可用，可以在本章程外层换回官方 MCP；当前脚本的断言结构仍然可以复用。
