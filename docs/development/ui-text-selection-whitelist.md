# ExoMind UI 文本选中白名单

> 状态：Draft for implementation
> 更新：2026-04-19
> 关联：[#503](https://github.com/exomind-team/exomind/issues/503), [#807](https://github.com/exomind-team/exomind/issues/807), `docs/development/ui-spec.md`

## 1. 这份文档是干什么的

这份文档定义 ExoMind 在采用“默认禁选，必要内容显式放开”策略时，哪些 UI 文本必须进入白名单，以及默认浏览器右键菜单在 Tauri / Web 两端的分流策略。

这里的“白名单”不是指“所有能读到的文字都要能选中”，而是指：

- 用户确实需要复制、摘录、核对或逐字阅读的内容面
- 调试、诊断、终端、JSON、日志这类技术输出面
- 浏览器原生可编辑输入控件
- Tauri 端是否抑制浏览器默认右键菜单，以及如何保留产品自定义右键能力

不在白名单里的大多数交互 chrome 默认应保持禁选，例如按钮文案、Tab 标题、Badge、设置项标题、Dialog 标题等。

## 2. GitHub 基线与判定语义

### 2.1 GitHub 与代码侧基线

- GitHub issue [#503](https://github.com/exomind-team/exomind/issues/503) 已确定方向：默认禁选，只对真正需要复制或编辑的内容显式开放。
- 当前仓库里显式 `select-text` / `user-select: text` 基本为空白；一旦落 `body { user-select: none }`，正文、日志、终端、JSON、文件内容会被一起误伤。
- 因此这份文档必须先把“哪些面必须恢复可选”写清楚，再做样式基线和实现收口。

### 2.2 统一判断语义

- 标题、标签、caption、按钮文案、Tab 名称、Badge 常规文案默认禁选。
- 正文、日志、终端、payload、JSON、诊断值、文件内容默认纳入白名单。
- 详情卡中的摘要正文可选，但同卡片的标题、标签仍禁选。
- 列表预览、折叠摘要、`line-clamp` 预览、可点击行里的技术 token 默认禁选。
- 整行可点击且承担复制或跳转的 UI，优先保留整行禁选；复制走点击行为、专用复制入口或详情页。

### 2.3 运行时分流：文本选中与默认右键菜单是两条独立策略

- 文本选中策略与默认右键菜单策略必须独立表达，不能共用一个布尔开关。
- `runtime = tauri` 时，目标是更像 App：
  - 默认禁选，按白名单显式放开正文、日志、终端、payload、文件内容
  - 默认抑制浏览器原生右键菜单
  - 但不禁用 `contextmenu` 事件本身，产品自定义右键能力必须继续工作
- `runtime = web` 时，目标是保持浏览器友好：
  - 不落全局“app-like”右键抑制
  - 保留浏览器默认右键菜单
  - 文本选中继续按 Web 端的浏览器友好策略处理
- “禁止默认右键菜单”不等于“全局禁止右键”：
  - 不可通过全局 `stopPropagation()` 或移除 `contextmenu` 事件来实现
  - 只能拦截浏览器默认菜单本身，保留自定义菜单和其他右键交互 affordance

## 3. 检索路线与来源

本次整理同时参考 GitHub 基线和当前代码实现，没有新增外部行业材料。

- GitHub：[#503](https://github.com/exomind-team/exomind/issues/503)
- 仓库规范：`AGENTS.md`、`docs/development/ui-spec.md`
- 当前实现：`src/components/`、`src/ui/app/pages/`、`src/ui/app/components/`、`src/pages/`
- 当前测试：`tests/unit/...` 与相关组件测试
- 运行时判定相关入口：`src/config/runtime-target.ts`、`src/lib/environment/bootstrap.ts`、`src/routes.tsx`、`src-tauri/tauri.conf.json`
- 当前自定义右键实现：`src/ui/app/pages/TaskDagPage.tsx`、`src/ui/app/pages/goals/components/TaskFlowEdge.tsx`、`src/ui/app/components/NowInputRow.tsx`
- Tauri 自定义 context menu 能力：`@tauri-apps/api/menu`

## 4. 显式白名单清单

> 这一节列的是“在未来落 `body { user-select: none }` 后，需要显式保住可选”的只读内容面。

| 优先级 | 表面 | 用户如何在 UI 里定位 | 为什么必须可选 | 当前实现锚点 |
| --- | --- | --- | --- | --- |
| P0 | 聊天消息正文 | 聊天页消息气泡正文；Agent 详情页点“与 Agent 对话”进入的对话页正文；网络页右侧聊天面板正文 | 用户需要复制回复、引用内容、核对代码块、逐字检查 agent 输出 | `src/components/Chat/EventMarkdown.tsx:35`, `src/components/Chat/ChatPage.tsx:996`, `src/components/Chat/ChatPage.tsx:1033`, `src/components/Chat/ChatPage.tsx:1094`, `src/ui/app/pages/agents/AgentConversationPage.tsx:394`, `src/ui/app/pages/AgentsPage.tsx:9813`, `src/ui/app/pages/AgentsPage.tsx:9846` |
| P0 | 提醒正文 | “提醒”页中每条提醒卡片里，标题与时间下方的正文卡片；正文为空时显示“（无正文）” | 提醒正文本质是用户内容，不是 chrome | `src/ui/app/pages/RemindersPage.tsx:273`, `src/ui/app/pages/RemindersPage.tsx:367`, `src/ui/app/pages/RemindersPage.tsx:381` |
| P0 | 提案详情正文 | “提案箱”页中选中提案后，右侧详情卡里的正文区域；未选中时附近会看到“从左侧选择一个提案...” | 提案正文是待审阅内容，需要复制、批注和对照 | `src/ui/app/pages/proposals/ProposalInboxPage.tsx:831`, `src/ui/app/pages/proposals/ProposalInboxPage.tsx:911` |
| P0 | 提案评论正文 | “提案箱”页详情区内的“评论区”，每条评论正文都是 Markdown 渲染 | 评论是协作内容，不应被当成 chrome | `src/ui/app/pages/proposals/ProposalInboxPage.tsx:995`, `src/ui/app/pages/proposals/ProposalInboxPage.tsx:1016` |
| P0 | 任务 DAG 详情面板的任务描述 | Task DAG / 依赖图里选中节点后，侧栏“任务描述”区域 | 这是任务正文，不是标签或按钮说明 | `src/ui/app/components/TaskDagDetailPanel.tsx:141`, `src/ui/app/components/TaskDagDetailPanel.tsx:147` |
| P0 | 任务详情页的任务描述 | 任务详情页正文区；有描述时显示 Markdown，没描述时附近会出现“+ 添加任务描述”入口 | 用户需要复制任务说明、链接、代码片段、清单项 | `src/ui/app/pages/TaskDetailPage.tsx:2373`, `src/ui/app/pages/TaskDetailPage.tsx:2395`, `src/ui/app/pages/TaskDetailPage.tsx:2422` |
| P0 | 任务详情页的事件时间线描述 | 任务详情页“事件时间线”卡片中每个事件条目的说明文字 | 这些条目是日志型正文，不是导航 chrome | `src/ui/app/pages/TaskDetailPage.tsx:1206`, `src/ui/app/pages/TaskDetailPage.tsx:1235`, `src/ui/app/pages/TaskDetailPage.tsx:1565`, `src/ui/app/pages/TaskDetailPage.tsx:1592` |
| P1 | 任务详情页的结构化总结正文 | 任务详情页里的“AI 总结”“计划 vs 实际”卡片正文；只放开正文本身，不放开卡片标题 | 这是 detail-card summary，用户需要摘录总结、对照计划与差异原因 | `src/ui/app/pages/TaskDetailPage.tsx:1271`, `src/ui/app/pages/TaskDetailPage.tsx:1274`, `src/ui/app/pages/TaskDetailPage.tsx:1278`, `src/ui/app/pages/TaskDetailPage.tsx:1281`, `src/ui/app/pages/TaskDetailPage.tsx:1284`, `src/ui/app/pages/TaskDetailPage.tsx:1294`, `src/ui/app/pages/TaskDetailPage.tsx:1297`, `src/ui/app/pages/TaskDetailPage.tsx:1300`, `src/ui/app/pages/TaskDetailPage.tsx:1303`, `src/ui/app/pages/TaskDetailPage.tsx:1651`, `src/ui/app/pages/TaskDetailPage.tsx:1654`, `src/ui/app/pages/TaskDetailPage.tsx:1657`, `src/ui/app/pages/TaskDetailPage.tsx:1660`, `src/ui/app/pages/TaskDetailPage.tsx:1666`, `src/ui/app/pages/TaskDetailPage.tsx:1669`, `src/ui/app/pages/TaskDetailPage.tsx:1672`, `src/ui/app/pages/TaskDetailPage.tsx:1675`, `src/ui/app/pages/TaskDetailPage.tsx:1678` |
| P1 | 时间块详情页的摘要反馈正文 | 时间块详情页顶部摘要卡里那段反馈文案；它出现在“开始 / 结束 / 时长”下方 | 这也是 detail-card summary 正文，用户可能需要复盘和复制 | `src/ui/app/pages/TimeBlockDetailPage.tsx:323`, `src/ui/app/pages/TimeBlockDetailPage.tsx:325` |
| P0 | 时间块详情页的关联日志描述 | 时间块详情页“关联日志”卡片内，每条关联日志的说明文字 | 这是事件内容本身，用户可能需要复制复盘 | `src/ui/app/pages/TimeBlockDetailPage.tsx:385`, `src/ui/app/pages/TimeBlockDetailPage.tsx:400` |
| P0 | 任意 `PtyTerminal` 终端输出区 | 任何嵌入式终端或独立终端页；独立页可通过“终端已断开”“输入命令或提示，Enter 发送到当前终端”等文案辨认 | 终端的核心交互之一就是鼠标选中复制 | `src/ui/app/components/PtyTerminal.tsx:757`, `src/ui/app/pages/agents/PtyTerminalPage.tsx:195`, `src/ui/app/pages/agents/PtyTerminalPage.tsx:265` |
| P0 | 设置页的调试日志内容区 | 设置页“调试日志”打开后的弹窗，标题就是“调试日志”，内部是等宽日志列表 | 日志查看器天然是复制面 | `src/ui/app/config/settings/settings-registry.ts:2078`, `src/ui/app/config/settings/LogPanelDialog.tsx:23`, `src/ui/app/components/settings/LogPanel.tsx:101` |
| P0 | 设置页的实例诊断详情值 | 设置页“实例诊断信息”打开后的 Dialog / Drawer；内容包含 `Branch`、`Web Port`、`RT Port`、`Sync URL` 等 | 诊断值用于人工核对和复制，不应困在只读 UI 里 | `src/ui/app/components/settings/settings-custom-items.tsx:1031`, `src/ui/app/components/settings/settings-custom-items.tsx:1074`, `src/ui/app/components/settings/settings-custom-items.tsx:1090` |
| P0 | Signal Detail 与内嵌 signal inspector 的技术值与 payload | Signal Detail 独立页，或 Agents 页里内嵌的 signal inspector；都能看到“信号 ID / 节点 ID”、topic、主机、Payload | 这些值是技术标识和诊断载荷，本质上是复制面 | `src/ui/app/pages/agents/SignalDetailPage.tsx:131`, `src/ui/app/pages/agents/SignalDetailPage.tsx:145`, `src/ui/app/pages/agents/SignalDetailPage.tsx:166`, `src/ui/app/pages/agents/SignalDetailPage.tsx:168`, `src/ui/app/pages/AgentsPage.tsx:9668`, `src/ui/app/pages/AgentsPage.tsx:9687`, `src/ui/app/pages/AgentsPage.tsx:9726`, `src/ui/app/pages/AgentsPage.tsx:9729` |
| P0 | Signal History 的展开 payload | Agents 页 `Signal History` 列表中，每条事件下方点“展开 payload”后出现的 `<pre>` | 展开后的 payload 是明确的调试载荷，不是列表 chrome | `src/ui/app/pages/agents/SignalHistoryTabView.tsx:56`, `src/ui/app/pages/agents/SignalHistoryTabView.tsx:144`, `src/ui/app/pages/agents/SignalHistoryTabView.tsx:147`, `src/ui/app/pages/agents/SignalHistoryTabView.tsx:148` |
| P0 | Workspace 的知识库文件内容 | Agents 页 `WorkspaceTabs` 中切到“知识库”后，文件内容预览的 `<pre>` | 文件内容是正文，不应因为在 Agent UI 里就失去可复制性 | `src/ui/app/pages/agents/WorkspaceTabs.tsx:210`, `src/ui/app/pages/agents/WorkspaceTabs.tsx:259`, `src/ui/app/pages/agents/WorkspaceTabs.tsx:517` |
| P1 | Workspace 的行动日志正文 | Agents 页 `WorkspaceTabs` 中切到“行动日志”后，每条时间线记录卡片里的描述正文；顶部会看到“最近 N 条记录” | 这是 agent 行为日志，本质上是复盘和复制用的正文，不是按钮或标签 | `src/ui/app/pages/agents/WorkspaceTabs.tsx:309`, `src/ui/app/pages/agents/WorkspaceTabs.tsx:318`, `src/ui/app/pages/agents/WorkspaceTabs.tsx:363`, `src/ui/app/pages/agents/WorkspaceTabs.tsx:521` |
| P0 | Workspace 的 `SOUL.md` 内容 | Agents 页 `WorkspaceTabs` 中切到“身份”后，标题为 `SOUL.md` 的大段身份文本 | 这是长文本规则说明，必须可选 | `src/ui/app/pages/agents/WorkspaceTabs.tsx:488`, `src/ui/app/pages/agents/WorkspaceTabs.tsx:493`, `src/ui/app/pages/agents/WorkspaceTabs.tsx:525` |
| P0 | Voice Runtime Lab 的转写和回复文本 | “语音运行时实验台”里“实时转写与感知”卡片中的“实时字幕”“最终文本”“模型回复文本” | 这些结果天然用于复制、对照、提交 bug 证据 | `src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx:1028`, `src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx:1035` |
| P0 | Voice Runtime Lab 的标准化感知 JSON | “实时转写与感知”卡片中的“标准化感知” `<pre>` | JSON 结构是明确的技术载荷 | `src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx:1040`, `src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx:1041` |
| P0 | Voice Runtime Lab 的供应商原始事件 payload | “供应商原始事件”卡片下的每条事件 payload `<pre>` | 原始事件就是白盒联调证据面 | `src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx:322`, `src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx:344`, `src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx:1092` |
| P1 | API Agent 的轮次结果正文 | 网络页顶部 `API Agent` tab 中“轮次结果”卡片下的 `assistantTurn.content` 和 `toolCalls` | 这是调试会话的核心输出，必须便于复制和对照 | `src/ui/app/pages/agents/ApiAgentTabView.tsx:550`, `src/ui/app/pages/agents/ApiAgentTabView.tsx:564`, `src/ui/app/pages/agents/ApiAgentTabView.tsx:576` |
| P1 | API Agent 的工具续跑输入证据 | `API Agent` tab 中“工具续跑”卡片里，每个 tool call 的 `toolCall.id` 和 `toolCall.input` JSON | 这是人工续跑时最需要复制和核对的内容 | `src/ui/app/pages/agents/ApiAgentTabView.tsx:591`, `src/ui/app/pages/agents/ApiAgentTabView.tsx:603`, `src/ui/app/pages/agents/ApiAgentTabView.tsx:606` |
| P1 | API Agent 的调试证据区 | `API Agent` tab 中“调试证据”卡片里的 `history draft`、`last request`、`last response` | 这三个区块是直接的排障证据面 | `src/ui/app/pages/agents/ApiAgentTabView.tsx:671`, `src/ui/app/pages/agents/ApiAgentTabView.tsx:677`, `src/ui/app/pages/agents/ApiAgentTabView.tsx:684`, `src/ui/app/pages/agents/ApiAgentTabView.tsx:691` |
| P1 | MOSS ASR 测试页的识别结果与运行日志 | 开发者打开 `MOSS ASR Test` 页后，能看到“识别结果”卡和“📋 运行日志”卡 | 这是典型的测试输出与诊断证据面，需要摘录结果和日志 | `src/pages/MOSSASRTestPage.tsx:656`, `src/pages/MOSSASRTestPage.tsx:659`, `src/pages/MOSSASRTestPage.tsx:678`, `src/pages/MOSSASRTestPage.tsx:701` |
| P1 | Volcano ASR 测试页的识别结果与运行日志 | 开发者打开 `Volcano ASR Test` 页后，能看到“识别结果”卡和“运行日志”卡 | 这是典型的测试输出与诊断证据面，需要摘录结果和日志 | `src/pages/VolcanoASRTestPage.tsx:601`, `src/pages/VolcanoASRTestPage.tsx:604`, `src/pages/VolcanoASRTestPage.tsx:627`, `src/pages/VolcanoASRTestPage.tsx:644` |
| P1 | 迁移失败弹窗的错误详情 | 数据迁移失败后，会弹出标题为“迁移失败”的 Dialog；红色错误框内是 `<pre>` 错误详情 | 失败原因是直接的排障证据，不应被禁选 | `src/ui/components/MigrationDialog.tsx:69`, `src/ui/components/MigrationDialog.tsx:76` |
| P1 | Workbench 的诊断 code 值 | `Agent Workbench / Agent 工作台` 中每个 pane 卡片内的 `View kind`、`Binding type`、`Session id`、`Destination` | 这些 code 值本质是调试 ID 和路径，用户有复制需求 | `src/ui/app/pages/workbench/WorkbenchPage.tsx:96`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:100`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:106`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:109`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:225` |

## 5. 浏览器原生可选区

> 这一节不是“显式补丁清单”，而是提醒：这些控件本来就应保持可选，不应被额外样式破坏。

- 任意原生 `Input` 文本框
- 任意原生 `Textarea` 多行输入框
- 未来若引入真正的 `contentEditable` 编辑器，其编辑区也应保持可选

当前共享入口：

- `src/components/ui/input.tsx`
- `src/components/ui/textarea.tsx`

当前典型 UI 例子：

- 任务详情页的描述编辑输入框
- 提醒页“内容（Markdown）”输入框
- 语音运行时实验台的 Tools JSON / 函数调用 JSON / 文本输入框
- API Agent 页的 system prompt、new user message、tool result 输入框

## 6. 已裁决的不开放表面

这些边界已经裁决完成，不再保留“待判定”状态。

| 表面 | 用户如何在 UI 里定位 | 裁决 | 为什么不进白名单 | 证据锚点 |
| --- | --- | --- | --- | --- |
| 设置页 `版本` / `构建` copy-row | 设置页“关于”分组里的“版本”“构建”； hover title 会提示“点击复制值” | 整行禁选 | 这是 SettingRow 型 copy-row，复制走点击整行，不做局部拖选 | `src/ui/app/config/settings/settings-registry.ts:2115`, `src/ui/app/config/settings/settings-registry.ts:2127`, `src/ui/app/components/settings/settings-renderers.tsx:1109`, `src/ui/app/components/settings/settings-renderers.tsx:1110` |
| `Signal History` 列表行内的 topic 与摘要预览 | Agents 页 `Signal History` 列表每一行；行本身可点开详情，内部显示 topic 和一行 `line-clamp-2` 摘要 | 整行禁选，仅展开后的 payload 可选 | 这是点击跳转行；局部拖选会破坏整行 affordance | `src/ui/app/pages/agents/SignalHistoryTabView.tsx:118`, `src/ui/app/pages/agents/SignalHistoryTabView.tsx:128`, `src/ui/app/pages/agents/SignalHistoryTabView.tsx:144` |
| `Routes` 表格与 `Nodes` 内嵌 route 列表里的技术 token 行 | Agents 页 `信号路由` 表格里的 `Topic / 目标`，以及 `Nodes` 视图下方 `topic → targetRef` 列表行 | 整行禁选 | 这是可点击编辑或跳转行，复制需求应走详情页或专用复制动作 | `src/ui/app/pages/agents/RoutesTabView.tsx:94`, `src/ui/app/pages/agents/RoutesTabView.tsx:118`, `src/ui/app/pages/agents/NodesTabView.tsx:248` |
| 标题、标签、按钮文案、Tab 名称、Badge 常规文案 | 任何页头标题、卡片标题、DialogTitle、DrawerTitle、TabsTrigger、普通 Badge | 默认禁选 | 这些是固定 UI chrome，不是用户内容块 | `src/components/ui/button.tsx`, `src/components/ui/tabs.tsx`, `src/components/ui/badge.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/drawer.tsx`, `src/ui/app/components/PageTabs.tsx` |
| 列表预览、折叠摘要、`line-clamp` 文本 | 提案箱左侧提案预览、任务列表描述预览、Agent Session 卡片摘要、Signal History 摘要、各类 collapsed preview | 默认禁选 | 它们承担浏览和点击入口，不承担逐字复制职责 | `src/ui/app/pages/proposals/ProposalInboxPage.tsx:811`, `src/ui/app/pages/TasksPage.tsx:220`, `src/ui/app/pages/agents/SessionCard.tsx:116`, `src/ui/app/pages/agents/TiledGrid.tsx:2081`, `src/ui/app/pages/agents/SignalHistoryTabView.tsx:128` |
| 详情卡中的标题与标签 | `AI 总结`、`计划 vs 实际`、`SOUL.md`、`识别结果` 等卡片标题；卡内字段标签如“关键产出”“阻塞点”“建议” | 标题与标签禁选，仅正文可选 | detail-card summary 只放开内容 body，不放开装饰性标题或字段名 | `src/ui/app/pages/TaskDetailPage.tsx:1271`, `src/ui/app/pages/TaskDetailPage.tsx:1278`, `src/ui/app/pages/TaskDetailPage.tsx:1281`, `src/ui/app/pages/TaskDetailPage.tsx:1284`, `src/ui/app/pages/TimeBlockDetailPage.tsx:308`, `src/ui/app/pages/TimeBlockDetailPage.tsx:310` |

## 7. 默认右键菜单策略

这部分描述的是“默认浏览器右键菜单”本身，不是文本选中白名单。

| 运行时 | 默认菜单策略 | 必须保留的能力 | 证据锚点 |
| --- | --- | --- | --- |
| Tauri | 抑制浏览器默认右键菜单 | 任务依赖图、Goals 边、Now 引用条目的自定义右键继续可用；后续若接入 Tauri `Menu.popup()`，也应在同一策略下工作 | `src/config/runtime-target.ts:123`, `src/lib/environment/bootstrap.ts:54`, `src/routes.tsx:227`, `src-tauri/tauri.conf.json:13`, `src/ui/app/pages/TaskDagPage.tsx:4157`, `src/ui/app/pages/goals/components/TaskFlowEdge.tsx:301`, `src/ui/app/components/NowInputRow.tsx:565`, `node_modules/@tauri-apps/api/menu/menu.d.ts:69` |
| Web | 保留浏览器默认右键菜单 | 不额外压制浏览器的复制、检查、打开链接等熟悉行为 | `src/routes.tsx:227`, `src/routes.tsx:258` |

明确排除：

- 不做“全局禁用右键事件”
- 不做“所有元素统一 `onContextMenu={e => e.preventDefault()}`”
- 不做“为了禁默认菜单而牺牲现有产品自定义右键”

## 8. 默认不进白名单的表面

下面这些默认仍按禁选处理：

- `Button` 文案
- `Tabs` / `PageTabs` / `Segmented Control` 的标题
- `Badge` 的一般状态文案
- `DialogTitle` / `DialogDescription`
- `DrawerTitle` / `DrawerDescription`
- 设置页普通 `SettingRow` 的标题、说明、Chevron 区
- 各类卡片标题、section heading、页头 eyebrow、页头 subtitle

代表实现：

- `src/components/ui/button.tsx`
- `src/components/ui/tabs.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/drawer.tsx`
- `src/ui/app/components/settings-shared.tsx`
- `src/ui/app/components/PageTabs.tsx`

## 9. 落地注意事项

- 不要先在页面里散补一堆 `select-text`。优先找共享承载点，例如 `EventMarkdown`、统一 `ReactMarkdown` wrapper、统一 payload viewer。
- Markdown / 富文本正文优先在统一 Markdown 容器放开，不在每个页面局部补丁。
- 技术输出优先在只读 `<pre>` / `<code>` / `font-mono` 结果容器放开，不把整张卡片都设为可选。
- 如果实现目标是“标签禁选、值可选”，但当前 DOM 把两者写在同一个文本节点里，例如 `关键产出：xxx`，就必须先拆出独立 label/value 容器，再上选择策略。
- 对整行 clickable 的 copy-row、路由行、历史列表行，不要直接把整行设成 `select-text`。
- `PtyTerminal` 属于特殊组件。它的选择复制逻辑不是普通 prose 规则，不能被全局基线误伤。
- 默认右键菜单策略优先落在 App 根部或统一 runtime controller，不要在各页面散补。
- 不要再新增第三套 Tauri/Web 判定方式；后续实现应统一收口到现有 runtime helper。
- Tauri 端抑制默认右键菜单后，`input` / `textarea` / 终端类区域的原生剪贴板菜单也会一起消失；若后续确实需要保留，必须显式设计豁免口，而不是回退全局策略。
- 全局默认菜单抑制只能 `preventDefault()`，不能顺手 `stopPropagation()`；否则会直接打断任务依赖图等自定义右键流程。

## 10. 最小验收清单

- 在聊天消息、提醒正文、提案正文/评论、任务描述、任务时间线描述、时间块关联日志中都能拖选文字。
- 在 detail-card summary 正文中能拖选文字，但标题与字段标签不会被误选。
- 在终端、日志、payload、JSON、`SOUL.md`、工作区文件预览、ASR 测试页输出、迁移失败错误详情中都能拖选文字。
- 在输入框和多行文本框中仍能正常选中、编辑、复制。
- `版本` / `构建` copy-row、`Signal History` 行、`Routes / Nodes` 技术列表行、按钮、Tab、Badge、Dialog/Drawer 标题不可拖选。
- Tauri 端右键时不再弹浏览器默认菜单，但任务依赖图、Goals 边等现有自定义右键仍能正常打开。
- Web 端继续保留浏览器默认右键菜单，不强行切成 App-like 行为。
