# Agent Hub 终端状态分层计划

日期：`2026-04-11`

## 背景与目标

本轮聚焦 Agent Hub 终端状态表达方式的收敛，而不是继续扩张 PTY/Session 状态机本身。

目标：

1. 把会话状态从 Unicode 字符升级为统一 Lucide 图标。
2. 把顶部布局收敛为“左侧集中信息，右侧集中操作”。
3. 复用平铺 pane 现有左下角状态位，承接更具体的 PTY 运行态，不新增栏位。
4. 清掉终端内部的非阻塞 banner；只有真正阻塞的异常才继续遮挡正文。
5. 实现完成后用 Tauri 真窗做桌面验收，而不是只停留在 `vitest + tsc`。

## 本轮范围

纳入：

- `SessionCard`
- `TiledGrid` 平铺 pane
- `PtyTerminal` 的非阻塞状态表现层
- 相关 metadata / 测试 / 桌面验收文档补记

不纳入：

- 独立 `PtyTerminalPage`
- 新增新的 footer / status bar
- 扩展新的后端 PTY 协议字段
- 大范围改动 Agent Hub 其他 surface（topology、graph 等）

## 状态分层模型

### 1. Session 状态

左上角主图标只表达 session 语义：

- `running`
- `waiting_input`
- `completed`
- `error`
- `paused`
- `archived`

图标固定映射：

- `running` -> `Play`
- `waiting_input` -> `TriangleAlert`
- `completed` -> `CircleCheckBig`
- `error` -> `CircleX`
- `paused` -> `Pause`
- `archived` -> `Archive`

### 2. PTY 展示态

本轮只接两类非阻塞 PTY 展示态：

- `output-reconnecting`
  - 文案：`输出重连中，输入暂停`
  - 无显式动作，系统自动恢复
- `input-readonly`
  - 文案：`输入只读，可重连`
  - 显式动作：`重连输入`

以下场景不归入“非阻塞 PTY 展示态”，继续走阻塞 overlay 或外层不可用态：

- 初始加载失败
- PTY 不存在 / 已断开
- 鉴权失败
- 协议不兼容

## UI 决策

### 顶部信息布局

统一为“左侧信息、右侧操作”。

左侧顺序固定：

1. Session 状态图标
2. 角色名
3. Agent 种类
4. `·`
5. 相对时间

右侧只允许操作类元素，不再承载时间文本。

### 会话卡片

- 去掉右侧独立时间块和 `Clock` 图标。
- `Claude / Codex / API` 不再使用填充 badge，改为轻量文本，时间紧跟其后。
- attention badge 仍保留在正文下方，只表达 session attention，不接 PTY 细状态。

### 平铺 pane header

- 顶部左侧承接：拖拽手柄 + 状态图标 + 角色名 + Agent 种类 + 时间。
- 顶部右侧只保留：
  - workbench actions
  - expand / minimize

### 平铺 pane 左下角状态位

复用现有 32px pane action bar 左侧槽位，不新增栏位。

优先级固定为：

1. 外层终端不可用态
   - `终端恢复中`
   - `终端会话缺少 PTY`
   - `终端已断开`
2. 非阻塞 PTY 展示态
3. Session attention
   - `等待输入`
   - `已暂停`
   - `出错`
4. `等待决策` 按钮
5. `turn_count`

规则：

- `completed / archived` 不显示 `终端已断开`
- `input-readonly` 时，左侧显示状态文案，右侧显示 `重连输入`
- `output-reconnecting` 时，左侧显示状态文案，右侧不新增动作

### 终端内部 overlay / banner

- 删除非阻塞 banner：
  - 输出重连 banner
  - 输入只读 banner
- 保留阻塞型 overlay：
  - loading
  - fatal stream error

## 实现步骤

1. 新建共享 UI 组件 `SessionStatusMark`
   - 只做 `session status -> Lucide` 映射
   - 不把 Lucide 引回 `src/lib/types/session.ts`
2. 调整 `SESSION_STATUS_INDICATORS`
   - 删掉 `shape`
   - 保留 `label`、`color`
   - 新增稳定 `tone`
3. 改 `SessionCard`
   - 状态图标替换 Unicode
   - 时间并入左侧 Agent 种类后
4. 改 `TiledGrid`
   - header 左右结构重排
   - footer 左侧改成单槽优先级
   - footer 右侧在 `input-readonly` 时提供 `重连输入`
5. 改 `PtyTerminal`
   - 外抛非阻塞 PTY 展示态
   - 不再内部渲染非阻塞 banner
6. 更新相关单测
7. 运行 `bunx tsc --noEmit` 与相关 `vitest`
8. 用 Tauri 真窗验收
9. 把验收经验补记到 `docs/development/tauri-mcp-windows-playbook.md`

## 测试与桌面验收

### 单元测试

必须覆盖：

- `session metadata` 不再依赖 `shape`
- `SessionStatusMark` 图标映射存在
- `SessionCard` 顶部布局：
  - 左侧出现状态图标
  - `Claude · 刚刚` 在左侧
  - 右侧不再单独显示时间
- `TiledGrid` 顶部布局：
  - 右上角不再显示时间
  - 左上角显示 Agent 种类 + 时间
- `TiledGrid` footer 优先级：
  - PTY 状态覆盖 `等待输入`
  - `等待输入` 覆盖 `turn_count`
  - `input-readonly` 时右侧出现 `重连输入`
- `PtyTerminal`
  - 输出重连时外抛 `output-reconnecting`
  - 输入只读时外抛 `input-readonly`
  - 非阻塞 banner 不再出现
  - fatal overlay 仍存在

### 桌面真窗验收

优先官方 Tauri MCP；
若 `driver_session` 仍报 `Transport closed`，按仓库 playbook 退回 raw bridge，不阻塞验收。

必测场景：

1. 平铺 pane 左上角为 `状态图标 + Claude · 刚刚`
2. 平铺 pane 右上角只保留操作
3. 会话卡片不再有独立右侧时间块
4. `waiting_input` 时，左下角显示 `等待输入`
5. 输出重连时，左下角显示 `输出重连中，输入暂停`
6. 输入只读时，左下角显示 `输入只读，可重连`，右侧出现 `重连输入`
7. fatal 场景仍显示阻塞 overlay

## 回写要求

实现完成后必须更新：

- `docs/development/tauri-mcp-windows-playbook.md`

补记内容至少包括：

- 本轮目标
- 实测实例真值
- 官方 Tauri MCP 是否可用
- 若 fallback 到 raw bridge，使用了哪些稳定 selector / 步骤
- 最终通过 / 未通过项
