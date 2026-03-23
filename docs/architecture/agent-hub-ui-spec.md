# Agent Hub UI 规范文档

> **版本**: v0.1 — 2026-03-05
> **状态**: 草稿（基于今日设计讨论，待用户评审）
> **来源**: ECS 协议审计（coder）+ 架构设计讨论（architect/team-lead）

---

## 1. 概述

Agent Hub 是 ExoMind 的**信号网络管理中心**，基于 ECS 7 层通信栈协议构建。

它的职责是：

- 可视化展示 ExoMind 运行时（RT）中所有 Agent、Actor、信号路由的拓扑关系
- 提供 Signal Route CRUD 操作（新建 / 编辑 / 删除 / 启用/禁用路由）
- 管理 Runtime Host 设备连接
- 查看实时信号历史（Journal）
- 安装/管理 Agent 市场中的 Agent

### 核心设计原则

| 原则 | 说明 |
|------|------|
| **协议驱动** | 每个 UI 组件对应 ECS 层的具体实体或操作，无凭空造物 |
| **双模式编辑** | 拓扑图（直觉）+ 表格（精确），操作同一份路由数据 |
| **桌面优先** | 三栏布局充分利用桌面屏幕，移动端降级为全屏/Sheet |
| **实时可见** | 连接状态、Agent 状态、Signal 流转均有实时反馈 |

---

## 2. 实体模型

### 节点（Vertices）

| 类型 | 对应 ECS 层 | 说明 |
|------|------------|------|
| **Signal Input** | ECS-7 | 用户输入信号的源头（user.input.text 等） |
| **Agent** | ECS-7 | out-of-process Agent（Claude CLI，SSE/POST 通信） |
| **Actor** | ECS-7 | in-process Actor（Rust，零开销直接调用） |
| **Output** | ECS-7 | 信号最终输出目标（任务/事件日志/前端通知等） |
| **Market** | 产品层 | Agent 市场入口节点 |

### 路由（Edges）

```
Signal Route: source_topic  →  target_type + target_ref
              (string)          (actor|agent|frontend) + (id)

属性：
  id         : UUID
  enabled    : boolean
  topic      : string (e.g. "user.input.text")
  target_type: "actor" | "agent" | "frontend"
  target_ref : agent/actor id 或 frontend 组件名
```

### 设备（Hosts）

```
RuntimeHostRecord:
  id         : string
  name       : string
  host       : string (IP / hostname)
  port       : number
  status     : "online" | "warning" | "offline" | "unknown"
  isLocal    : boolean
  lastCheckedAt : ISO timestamp
  lastError  : string?
```

---

## 3. Tab 结构（已确认）

```
┌─────────────────────────────────────────────────────────┐
│  Agent Hub              [查看模式 ○|● 编辑模式]  [+ 添加] │
├─────────────────────────────────────────────────────────┤
│  [拓扑图]  [节点]  [路由]  [设备]                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   (Tab 内容区)                                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.1 拓扑图 Tab

- React Flow 画布，展示所有节点和路由的有向图
- 支持**查看模式**（只读，节点可点击查看详情）和**编辑模式**（可拖线创建路由）
- 查看模式：点击节点 → 右侧栏打开详情（Agent/Actor/Route/Signal）
- 编辑模式：从节点 A 拖出连线到节点 B → 弹出创建路由表单 → 右侧栏确认
- Phase 1 仅实现查看模式；Phase 2 实现编辑模式

**节点布局规则**（`buildSignalGraph` 逻辑，维持列式布局）：

```
列 0: Signal Input 节点
列 1: Agent 节点
列 2: Actor 节点
列 3: Output / Frontend 节点
```

### 3.2 节点 Tab

- 展示所有 Agent/Actor/Signal Input/Output 的列表视图
- Filter 栏：`[全部] [信号输入] [Agent] [Actor] [输出]`
- 每行：节点 icon + 名称 + 状态 badge + 描述摘要
- 点击行 → 右侧栏打开详情（AgentDetail / ActorDetail）

### 3.3 路由 Tab（P0 优先实现）

- 路由表格：展示所有 SignalRoute，含列 `启用 | topic | → | target_type | target_ref | 操作`
- 操作列：编辑按钮、删除按钮、enable/disable 开关
- 新建路由：点击 `+ 添加` → 右侧栏打开 Route 创建表单
- 点击行 → 右侧栏打开 Route 编辑表单
- 实时刷新（RT 更新后 UI 同步）

**路由表格列定义：**

```
启用     topic              →   target_type   target_ref       操作
●       user.input.text        agent         classifier-01    [编辑][删除]
●       input.classified       actor         task-creator     [编辑][删除]
○       session.end            agent         reviewer-01      [编辑][删除]
```

### 3.4 设备 Tab

- 展示所有已注册的 RuntimeHost 设备卡片
- 每张卡片：设备名 + host:port + 状态 badge + 最后检测时间 + 延迟
- 操作：探测连接（Probe）/ 删除设备 / 添加新设备
- 添加新设备：`+ 添加` → 右侧栏打开 Host 添加表单（name / host / port）

---

## 4. 桌面端布局（已确认）

```
┌──────┬──────────────────────────────────┬───────────────────┐
│      │                                  │                   │
│  60  │         内容区 (flex-1)           │  右侧栏 (380px)   │
│  px  │                                  │  条件渲染          │
│      │   Tab 内容（拓扑图/节点/路由/设备） │                   │
│      │                                  │  (CLOSED 时不渲染) │
│ExoMind│                                 │                   │
│Sidebar│                                 │                   │
│      │                                  │                   │
└──────┴──────────────────────────────────┴───────────────────┘
```

### 右侧栏状态机（已确认）

```
                    ┌─────────────┐
                    │   CLOSED    │◄─────── ESC / 关闭按钮
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
   ┌────────────┐  ┌──────────────┐  ┌────────────────┐
   │ ROUTE_EDIT │  │SIGNAL_DETAIL │  │  AGENT_DETAIL  │
   │ 路由创建/编辑│  │ 信号历史详情  │  │  Agent 详情    │
   └────────────┘  └──────────────┘  └────────────────┘
          ▲                                 │
          │                          ┌──────┴──────┐
          │                          ▼             ▼
          │                  ┌─────────────┐ ┌──────────────┐
          │                  │ACTOR_DETAIL │ │  AGENT_CHAT  │
          │                  │ Actor 详情  │ │  对话界面    │
          │                  └─────────────┘ └──────────────┘
          │
          └── (从拓扑图拖线 / 路由列表点击编辑)
```

**状态转换规则：**

| 触发操作 | 目标状态 |
|---------|---------|
| 点击拓扑图 Agent 节点 | `AGENT_DETAIL` |
| 点击拓扑图 Actor 节点 | `ACTOR_DETAIL` |
| 点击拓扑图 Edge（路由） | `ROUTE_EDIT` |
| 点击信号历史列表项 | `SIGNAL_DETAIL` |
| 点击 `+ 添加` → 添加路由 | `ROUTE_EDIT`（新建模式） |
| Agent 详情点击"对话" | `AGENT_CHAT` |
| 点击关闭按钮 / ESC | `CLOSED` |
| 切换 Tab | `CLOSED`（保守策略，避免内容不一致） |

---

## 5. 统一添加按钮（已确认）

- 位置：Header 区域右上角
- 样式：`[+ 添加 ▾]` Dropdown Trigger Button
- 点击展开 Popover Dropdown，包含 6 个选项：

```
┌─────────────────────┐
│  + 添加              │
├─────────────────────┤
│ ⬛ 添加信号输入       │
│ 🟦 添加 Agent        │
│ 🟨 添加 Actor        │
│ ⬜ 添加输出节点       │
│ ────────────────── │
│ ➕ 添加信号路由       │
│ ────────────────── │
│ 🛒 从市场安装         │
└─────────────────────┘
```

- 选择后：右侧栏打开对应**创建表单**（`ROUTE_EDIT` / `AGENT_DETAIL` 新建模式等）
- 移动端降级：点击 `+ 添加` → 底部 `AddNodeSheet`（已有组件）

---

## 6. 路由编辑交互（已确认：方案 C 混合模式）

两个入口编辑**同一份路由数据**：

```
路由数据（SignalPool RouteTable）
    ▲                    ▲
    │                    │
拓扑图 Tab            路由 Tab
（直觉模式）           （精确模式）
拖线创建/点击边编辑    表格 CRUD + 右侧栏表单
```

### 分阶段实现计划

| Phase | 功能 | 优先级 | 对应 ECS 层 |
|-------|------|--------|------------|
| Phase 1 | 路由 Tab 表格 CRUD + 右侧栏表单编辑 | **P0** | ECS-5 |
| Phase 2 | 拓扑图编辑模式（拖线创建路由） | P1 | ECS-5 |
| Phase 3 | 节点上下文菜单（右键快捷操作） | P2 | ECS-5 |

### Phase 1 路由表单字段

```
创建/编辑路由
─────────────
topic *      [user.input.text          ▾]   (可选已有 topic / 手动输入)
target_type* [● actor  ○ agent  ○ frontend]
target_ref * [classifier-01             ▾]   (根据 target_type 过滤列表)
enabled      [●] 启用
─────────────
             [取消]  [保存]
```

### Phase 2 拓扑图编辑交互

```
编辑模式激活：Header 右侧 [查看模式 ○|● 编辑模式] 切换

拖线流程：
  1. hover Agent/Actor 节点 → 节点边缘出现连接锚点
  2. 从锚点拖出 → 拖动时显示虚线预览边
  3. 拖到目标节点 → 松手 → 右侧栏自动弹出创建路由表单
     （topic 预填为源节点的 output topic，target_ref 预填为目标节点 id）
  4. 确认保存 → 边固化 + 路由写入 RT

点击已有边：
  → 边高亮 + 右侧栏打开路由编辑（ROUTE_EDIT 模式）
```

---

## 7. 移动端适配

| 桌面端 | 移动端降级 |
|--------|----------|
| 右侧栏 Agent/Actor 详情 | 全屏 push 页面 |
| 右侧栏 Route 编辑 | 底部 Sheet（高度 60vh） |
| 右侧栏 Signal 详情 | 底部 Sheet（高度 50vh） |
| `+ 添加` Dropdown | 底部 `AddNodeSheet`（已有组件） |
| 拓扑图拖线创建路由 | 点击节点 A → 节点变为"选中源"状态 → 点击节点 B → 弹出确认 Sheet |
| 三栏布局 | 单栏 + 全屏覆盖 |

**移动端拓扑图连线替代方案（点击序列）：**

```
1. 进入编辑模式
2. 点击源节点 A → A 节点高亮，进入"待连接"状态（蓝色环绕）
3. 点击目标节点 B → 底部 Sheet 弹出路由创建表单
4. 确认 → 创建路由，A→B 连线出现
5. 点击空白区域 → 取消选中
```

---

## 8. 视觉规范

### 色彩系统

| Token | 用途 | Hex |
|-------|------|-----|
| `bg-base` | 页面背景 | `#0C0A09` |
| `bg-card` | 卡片背景 | `#1C1917` |
| `bg-border` | 边框 | `#292524` |
| `primary` | 主色（操作按钮） | `#C75B3A` / hover `#E8734E` |
| `agent-teal` | Agent 节点色 | `#0D9488` |
| `actor-amber` | Actor 节点色 | `#F59E0B` |
| `input-orange` | Signal Input 节点色 | `#F97316` |
| `output-blue` | Output 节点色 | `#2AABEE` |
| `status-online` | 连接在线 | `#22C55E` |
| `status-warning` | 重连中 | `#F59E0B` |
| `status-offline` | 离线 | `#EF4444` |
| `route-active` | 路由启用 | `#22C55E` |
| `route-inactive` | 路由禁用 | `#6B7280`（半透明） |

### 节点形状规范

| 节点类型 | 形状 | 主色 | 说明 |
|---------|------|------|------|
| Signal Input | 方角矩形 + 左侧竖线 | `#F97316` | 左侧竖线表示"输入源" |
| Agent | 方角矩形 | `#0D9488` | out-of-process，矩形代表"独立进程" |
| Actor | 圆角矩形 | `#F59E0B` | in-process，圆角代表"嵌入式" |
| Output | 方角矩形 + 右侧竖线 | `#2AABEE` | 右侧竖线表示"输出端" |
| Market | 虚线边框矩形 | `#6B7280` | 虚线代表"可选安装" |

### 字体规范

| 用途 | 字体 | 说明 |
|------|------|------|
| UI 文字（标题、标签、描述） | Inter | 清晰易读 |
| topic / 信号类型 / 代码 | IBM Plex Mono | 等宽字体，区分信号标识符 |

### 状态 Badge 规范

```
连接状态：
  ● online      (绿色实心圆 + "在线")
  ◉ reconnecting (琥珀色闪烁圆 + "重连中 3s")
  ○ offline     (红色空心圆 + "离线")

路由状态：
  [启用]    绿色实心 badge
  [禁用]    灰色半透明 badge

Agent/Actor 状态：
  [运行中]  teal badge
  [空闲]    灰色 badge
  [警告]    amber badge
  [离线]    red badge
```

---

## 9. ECS → UI 映射表（精简版）

> 详细审计见 coder ECS Protocol Audit 报告（2026-03-05）

| ECS 层 | 核心实体/操作 | UI 现状 | 缺口 | 优先级 |
|--------|-------------|---------|------|--------|
| ECS-1 Physical | 传输媒介（WiFi/BLE/IPC） | ❌ 无 | Device View 传输媒介图标 | P2 |
| ECS-2 Transport | 帧编码格式（JSON/CBOR） | ❌ 无 | 调试面板 | P3 |
| ECS-3 Mesh | mDNS 发现、hop 字段 | ⚠️ Device View 存在但静态 | 扫描设备按钮、relay 路径可视化 | P2 |
| ECS-4 Connection | SSE 连接、重连、Last-Event-ID | ⚠️ 后端完整，UI 盲 | 连接状态 badge + 重连倒计时 | **P1** |
| ECS-5 Routing | Signal Route CRUD、enable/disable | ⚠️ 只读拓扑图 | **路由 Tab CRUD UI**（P0） | **P0** |
| ECS-6 Contract | SignalEvent schema、Journal | ⚠️ 事件流有但无 UI | Signal History 面板 + 详情弹窗 | **P1** |
| ECS-7 Semantics | Actor/Agent、触发规则、信号语义 | ⚠️ 只读详情页 | Trigger Rules 编辑、Actor/Agent 区分 | **P1** |

---

## 10. Pencil 设计执行计划

按依赖关系排列的 10 个 Screen 设计顺序：

| 顺序 | Screen 名称 | 对应功能 | 依赖 | 要点 |
|------|------------|---------|------|------|
| 1 | `AgentHub-Desktop-Overview` | 三栏布局骨架（无右侧栏） | 无 | 确立三栏比例（60px + flex-1 + 380px）、Tab 切换、Header |
| 2 | `AgentHub-Topology-ViewMode` | 拓扑图查看模式 | Screen 1 | React Flow 节点样式、边样式、节点状态 badge |
| 3 | `AgentHub-RightPanel-RouteEdit` | 右侧栏路由编辑表单 | Screen 1 | 表单布局、topic 输入、target_type 选择器 |
| 4 | `AgentHub-Routes-Tab` | 路由 Tab 表格 | Screen 1 | 表格列布局、enable/disable 开关、操作列 |
| 5 | `AgentHub-RightPanel-AgentDetail` | 右侧栏 Agent 详情 | Screen 1 | Stats/TriggerRules/OutputTargets/RecentLogs tabs |
| 6 | `AgentHub-Nodes-Tab` | 节点 Tab 列表 + Filter | Screen 1 | Filter bar、节点行布局、状态 badge |
| 7 | `AgentHub-Devices-Tab` | 设备 Tab 卡片 | Screen 1 | Host 卡片、状态 badge、Probe 按钮 |
| 8 | `AgentHub-SignalHistory-Panel` | Signal History 面板（右侧栏） | Screen 2 | SignalEvent 字段展示、topic/ts/trace_id |
| 9 | `AgentHub-Topology-EditMode` | 拓扑图编辑模式 | Screen 2 | 编辑模式切换、锚点、虚线预览边 |
| 10 | `AgentHub-Mobile-Overview` | 移动端单栏布局 | Screen 1-7 | 底部 Tab bar、全屏 push 页、底部 Sheet |

### Screen 1 优先原则

Screen 1（三栏骨架）是所有其他 Screen 的基础。优先设计并确认：
- ExoMind Sidebar 宽度（60px）与 Agent Hub 内容区的边界
- Header 高度与元素（Tab 切换 + 查看/编辑模式切换 + `+ 添加` 按钮）
- 右侧栏宽度（380px）与内容区的分隔线样式
- 深色主题背景色调

---

## 附录：已确认 vs 待实现

### 已确认（可直接进入设计/开发）

- [x] Tab 结构：拓扑图 / 节点 / 路由 / 设备 四 Tab
- [x] 桌面端三栏布局尺寸（60px + flex-1 + 380px）
- [x] 右侧栏状态机（6 个状态 + 转换规则）
- [x] 统一 `+ 添加` 按钮 + 6 个选项
- [x] 方案 C 混合路由编辑模式（拓扑图 + 表格双入口）
- [x] Phase 1 优先：路由 Tab 表格 CRUD
- [x] 深色主题色彩系统（背景 / 主色 / 节点色 / 状态色）
- [x] 节点形状规范（Agent 方角 / Actor 圆角）
- [x] 字体规范（Inter + IBM Plex Mono）

### 待实现（需进一步设计）

- [ ] Signal History 面板的具体交互（过滤 / 搜索 / 分页）
- [ ] Agent/Actor 详情页编辑模式（Trigger Rules 编辑表单）
- [ ] Market Tab 的具体展示方案
- [ ] ECS-3 设备发现 UI（依赖 iroh/mDNS 实现）
- [ ] 拓扑图编辑模式（Phase 2）完整交互细节
- [ ] 连接状态实时更新的刷新策略（轮询间隔 / WebSocket 推送）

---

*文档维护人：architect / coder*
*最后更新：2026-03-05*
