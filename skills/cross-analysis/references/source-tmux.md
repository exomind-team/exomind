# tmux

本文件是 `tmux` 的本地化搜索指南，不是产品百科。

它的目标是帮助 Agent 在遇到相关目的时，快速判断：

- 这个参考源值不值得纳入交叉分析
- 应该先从哪些入口开始检索
- 哪些主题适合参考它
- 哪些主题不应把它当作主参考

## 适合优先参考的目的

当用户目的涉及以下方向时，优先考虑 `tmux`：

- 终端 runtime 如何把 `session / window / pane / client` 拆成稳定对象层
- 会话如何脱离当前终端窗口或客户端继续存在，并支持 `attach / detach / reattach`
- 多个客户端如何连接同一批终端对象，以及“当前视图”与“底层会话”如何分离
- 终端管理系统如何提供脚本化控制面，例如 `list-*`、`display-message`、`capture-pane`、`send-keys`
- 终端对象如何用稳定 ID、target 语法、socket / server 边界来组织
- 交互式终端管理里已有对象的选择、切换、聚焦、显示编号等命令面如何组织

## 不要把它当成主参考的情况

以下场景里，`tmux` 通常不应作为唯一主参考：

- 现代 GUI 终端产品的视觉、标签栏、拖拽布局、动画与鼠标 UX 设计
- Windows Terminal、Electron、Tauri、浏览器 WebTerminal 这类图形终端壳层实现
- 终端渲染、VT/ANSI 兼容、`TERM`/terminfo 细节本身
- 云端协作终端、多人共享编辑、浏览器远程会话协议
- 业务产品里的“任务 / agent / workflow 语义”建模

说明：

- 这里写的是“参考价值边界”，不是产品优劣判断。
- 对终端管理问题，`tmux` 更适合作为“会话生命周期、对象层次、脚本接口参考”，不是“现代图形终端产品形态参考”。

## 优先检索入口

### 1. 官方产品入口

- 仓库首页 / README：`https://github.com/tmux/tmux`

适合先回答：

- `tmux` 的核心定位是什么
- 它首先解决的是“终端复用”还是“图形终端壳层”
- 官方把文档入口主要导向哪里

优先关注：

- terminal multiplexer
- detached / reattached
- tmux.1
- wiki
- FAQ

### 2. 官方帮助文档

- 用户帮助 / Wiki Getting Started：`https://github.com/tmux/tmux/wiki/Getting-Started`
- FAQ：`https://github.com/tmux/tmux/wiki/FAQ`

适合先回答：

- `server / client / session / window / pane` 的官方术语与关系
- attach / detach / list-sessions / new-session 这些基础行为如何定义
- 常见运行边界，例如 socket、`no sessions`、多 client、窗口大小策略

如果目的是 `终端会话持久化`、`session 脱离 client 持续存在`、`pane/window/session 层级`，优先检索这些关键词：

- server and clients
- sessions, windows and panes
- attach-session
- detach-client
- list-sessions
- choose-tree
- display-panes

### 3. 官方开发文档

- 权威手册：`https://man.openbsd.org/tmux`
- 手册源码：`https://github.com/tmux/tmux/blob/master/tmux.1`
- 进阶文档：`https://github.com/tmux/tmux/wiki/Advanced-Use`
- 格式系统：`https://github.com/tmux/tmux/wiki/Formats`

适合先回答：

- 每个命令、flag、target、format 的官方定义是什么
- 控制模式、脚本化获取状态、唯一 ID、默认 target 推导规则是什么
- 如果要从“交互式工具”转向“自动化 / 宿主集成”，应该先看哪些能力

### 4. GitHub 组织与仓库

优先看这些入口：

- 组织页：`https://github.com/tmux`
- 核心仓库：`https://github.com/tmux/tmux`
- 命令权威定义：`https://github.com/tmux/tmux/blob/master/tmux.1`
- server / client 入口：`https://github.com/tmux/tmux/blob/master/server-client.c`
- control mode 入口：`https://github.com/tmux/tmux/blob/master/control.c`
- 通知与订阅：`https://github.com/tmux/tmux/blob/master/control-notify.c`
- format 解析：`https://github.com/tmux/tmux/blob/master/format.c`

如果目的是：

- 看 attach / detach / session 生命周期：先看 `tmux.1`，再按命令跳到 `cmd-attach-session.c`、`cmd-detach-client.c`、`cmd-new-session.c`
- 看服务端对象与 client 关系：先看 `Getting Started` 和 `tmux.1`，再补 `server.c`、`server-client.c`、`server-fn.c`
- 看机器接口与状态采集：先看 `CONTROL MODE`、`Advanced Use` 的 scripting 部分，再补 `control.c`、`control-notify.c`、`format.c`

### 5. 社区 / 论坛 / Showcase

- FAQ：`https://github.com/tmux/tmux/wiki/FAQ`
- 邮件组：`https://groups.google.com/g/tmux-users`
- Issue / PR：`https://github.com/tmux/tmux/issues`

适合先回答：

- 某个行为是官方稳定语义、兼容性边界，还是环境问题
- 多 client / 多窗口尺寸 / socket / `TERM` 等常见坑通常怎样定位
- 某个需求是官方已有能力组合，还是需要自己在宿主层补

优先关注这些板块：

- FAQ 中的 socket / session / multi-client 条目
- issue 里关于 control mode、format、attach / detach 的讨论
- 邮件组里关于脚本化和兼容性边界的历史讨论

## 面向常见目的的检索路线

### 目的：终端会话独立于当前客户端持续存在

建议路线：

1. 先看 `Getting Started` 的 `The tmux server and clients`、`Sessions, windows and panes`、`Attaching and detaching`
2. 再看 `tmux.1` 的 `DESCRIPTION` 以及 `attach-session`、`new-session`、`list-sessions`
3. 必要时补 `FAQ` 里 `no sessions`、多 client attach、socket 重建等条目

重点想确认的问题：

- session 和 client 是否是明确分离的两层
- session 在没有 attached client 时是否继续存在，以及 server 在什么条件下退出
- 多 client 连接同一 session 时，当前窗口、尺寸和 detach 行为如何处理

### 目的：给终端系统建立稳定对象模型与定位语法

建议路线：

1. 先看 `Getting Started` 的术语表，确认 `session / window / pane / client` 的官方边界
2. 再看 `Advanced-Use` 的 `Unique identifiers`、`The default target`、`Command targets`、`Getting information`
3. 必要时补 `tmux.1` 与 `cmd-list-sessions.c`、`cmd-list-clients.c`、`cmd-list-panes.c` 对照命令面

重点想确认的问题：

- 用户可见名称和 server 内稳定 ID 是否分离
- target 语法如何从 session、window、pane 三层定位对象
- 对象迁移、重命名、重新编号后，脚本如何保持稳定引用

### 目的：为宿主应用补一个脚本化 / 控制面

建议路线：

1. 先看 `tmux.1` 的 `CONTROL MODE` 和 `FORMATS`
2. 再看 `Advanced-Use` 的 `Getting information`、`Capturing pane content`、`Sending keys`、`Socket and multiple servers`
3. 必要时补 `control.c`、`control-notify.c`、`format.c`，以及 `cmd-capture-pane.c`、`cmd-list-panes.c`

重点想确认的问题：

- 是否存在机器可读而不是纯交互式的控制协议
- 如何订阅 pane 输出、layout 变化、session 变化这类通知
- 如何安全地列举对象、抓取输出、发送输入，并区分多个 server / socket

## 适合从 tmux 借鉴什么

通常适合借鉴：

- `server` 统一持有 `session / window / pane / client`，而不是把“当前 UI 视图”当成会话真相
- session 可脱离 client 持续存在，`attach / detach / reattach` 是显式能力而不是异常恢复特例
- 对象的稳定 ID、名称、索引、target 语法分层清晰，便于脚本和 UI 同时工作
- `list-*`、`display-message -p`、`capture-pane`、`send-keys`、`control mode` 这类“控制面 + 查询面”组合
- 用 socket / 多 server 把“同一套命令语义”复用于不同 runtime 实例

## 不要急着从 tmux 借鉴什么

通常不要直接从它推导：

- 面向普通用户的现代 GUI 终端交互与视觉方案
- 基于本地 Unix socket 和 CLI 命令面的跨平台产品架构默认值
- `TERM`、terminfo、复制模式、键位表这些终端兼容性历史包袱
- 把 pane / window / session 的 CLI 命名直接搬成业务产品里的最终用户术语
- 认为“支持 attach / detach”就等于已经解决了历史会话恢复、视图占用、跨设备同步等更高层问题

## 一句话判断

如果用户目的是：

- “终端系统该不该把 session 从当前 client / view 里拆出来”
- “server 如何统一管理 session / window / pane / client，并允许 detach 后继续存在”
- “要不要为终端 runtime 提供 list / capture / send / subscribe 这类脚本控制面”

那么 `tmux` 应该进入优先参考源集合。
