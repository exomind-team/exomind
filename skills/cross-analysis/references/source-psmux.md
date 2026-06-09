# psmux

本文件是 `psmux` 的本地化搜索指南，不是产品百科。

它的目标是帮助 Agent 在遇到相关目的时，快速判断：

- 这个参考源值不值得纳入交叉分析
- 应该先从哪些入口开始检索
- 哪些主题适合参考它
- 哪些主题不应把它当作主参考

## 适合优先参考的目的

当用户目的涉及以下方向时，优先考虑 `psmux`：

- 终端会话独立于客户端，客户端只负责 attach / detach / 切换视图
- 终端 `session / window / pane / client` 的分层与稳定身份边界
- Windows 语境下的 tmux-compatible 终端管理模型
- 如何让外部程序通过控制协议驱动现有终端会话
- 基于 pane 的 Agent 团队、多终端协作、可见化终端分工
- 会话恢复、客户端重连、历史会话与当前实例分离这类终端生命周期问题

## 不要把它当成主参考的情况

以下场景里，`psmux` 通常不应作为唯一主参考：

- Unix tmux 一台 server 承载多 session 的完整原始语义考证
- 非 Windows / 非 ConPTY 环境下的通用 PTY 或终端渲染实现
- 云端终端托管、多租户权限、强实时多人协作协议
- 通用 IDE / Web 终端前端视觉设计与标签页产品形态
- 与终端无关的通用窗口管理或桌面布局系统

说明：

- 这里写的是“参考价值边界”，不是产品优劣判断。
- 对 ExoMind 这类问题，`psmux` 更适合作为“Windows 终端会话管理、attach/detach、控制协议、pane 化 agent 协作”的参考，而不是通用终端理论总参考。

## 优先检索入口

### 1. 官方产品入口

- 官网：`https://psmux.pages.dev/`

适合先回答：

- `psmux` 的产品定位是什么
- 它强调的是“终端 server + 会话持久化”，还是单纯 tab / pane UI
- 官方主推哪些能力面：tmux 兼容、session persist、mouse、agent teams、scripting

优先关注：

- tmux on Windows
- session persistence
- detach / reattach
- tmux-compatible commands
- Claude Code agent teams

### 2. 官方帮助文档

- 用户帮助：`https://github.com/psmux/psmux/tree/master/docs`

适合先回答：

- 官方把哪些主题单独沉淀成文档
- “会话 / 客户端 / 控制模式 / warm session / agent teams”各自的术语是什么
- 下一步应该继续看哪篇专门文档

如果目的是 `会话独立于客户端`、`控制协议`、`会话恢复`、`Agent pane 协作`，优先检索这些关键词：

- control mode
- scripting
- warm sessions
- claude code
- compatibility
- list-clients
- switch-client

### 3. 官方开发文档

- 开发文档：`https://github.com/psmux/psmux/blob/master/docs/control-mode.md`

适合先回答：

- 外部程序如何连接并驱动已有终端会话
- `session / window / pane / client` 在协议层用什么稳定 ID 表达
- 哪些能力适合事件驱动，哪些仍要命令查询

如果目的是命令面与目标语法，继续补：

- `https://github.com/psmux/psmux/blob/master/docs/scripting.md`

如果目的是新会话预热、claim、隐藏 warm session，继续补：

- `https://github.com/psmux/psmux/blob/master/docs/warm-sessions.md`

如果目的是 Agent 团队如何借 tmux pane 运行，继续补：

- `https://github.com/psmux/psmux/blob/master/docs/claude-code.md`

### 4. GitHub 组织与仓库

优先看这些入口：

- 组织页：`https://github.com/psmux`
- 核心仓库：`https://github.com/psmux/psmux`
- 源码入口：`https://github.com/psmux/psmux/tree/master/src`

如果目的是：

- 看 `session / window / pane / client` 对象模型：先看 `src/types.rs`
- 看 server 如何持有会话、监听连接、写 port/key、管理 warm session：先看 `src/server/mod.rs`
- 看 attach、persistent client、control client、认证与命令分发：先看 `src/server/connection.rs`
- 看命令面与 tmux 兼容能力边界：先看 `docs/scripting.md` 与 `docs/compatibility.md`

### 5. 社区 / 论坛 / Showcase

- 社区入口：`https://github.com/psmux/psmux/discussions`

适合先回答：

- 某个 Windows / PowerShell / ConPTY 限制是不是已知边界
- 某种 tmux 兼容行为是官方能力、实验能力，还是仅在讨论中提到
- Agent teams、插件、控制模式有没有真实使用案例

优先关注这些板块：

- Discussions
- Issues
- Releases / changelog

## 面向常见目的的检索路线

### 目的：分析“会话独立于客户端，客户端只是 attach / detach”

建议路线：

1. 先看 `README.md` 与 `docs/features.md`，确认官方怎样表述 session persist、detach、reattach
2. 再看 `docs/scripting.md` 与 `docs/control-mode.md`，确认 `list-clients`、`switch-client`、稳定 ID、通知事件
3. 需要源码落点时，再看 `src/types.rs`、`src/server/connection.rs`、`src/server/mod.rs`

重点想确认的问题：

- 会话对象是否由 server 持有，而不是由当前客户端持有
- `client` 与 `session / window / pane` 是否被明确分开建模
- 客户端断开后，会话是否继续存在，重连入口是什么
- 当前连接、历史会话、当前 pane / window 视图之间的边界怎样表达

### 目的：分析“如何让外部程序驱动和观测终端会话”

建议路线：

1. 先看 `docs/control-mode.md`
2. 再看 `docs/scripting.md`，补命令、target、查询方式
3. 若需要协议或实现细节，再看 `src/server/connection.rs` 与 `src/server/mod.rs`

重点想确认的问题：

- 控制协议是命令轮询、事件推送，还是两者结合
- 哪些实体 ID 是稳定的，适合拿来做外部绑定
- `dump-state`、`list-windows`、`list-panes`、`list-clients` 适合解决什么层级的问题
- 连接认证、命名空间、session 发现是怎样做的

### 目的：分析“pane 化 Agent 协作 / Windows 上的 tmux-compatible agent terminal”

建议路线：

1. 先看 `docs/claude-code.md`，确认它如何把 agent teammate 映射到 pane
2. 再看 `README.md`、`docs/features.md`、`docs/compatibility.md`，确认哪些是 tmux 兼容面，哪些是 psmux 自己的扩展
3. 若还要看会话启动与恢复，再补 `docs/warm-sessions.md` 与 `src/server/mod.rs`

重点想确认的问题：

- agent pane 的创建是基于 tmux 兼容命令，还是私有 API
- 哪些能力是 Windows / PowerShell 特定适配，不能直接外推到其他终端
- “可见 pane 团队”与“隐藏式工作进程 / worktree”分别落在哪一层
- 会话预热、重连、切 pane 与 session 身份是否被拆开处理

## 适合从 psmux 借鉴什么

通常适合借鉴：

- `session / window / pane / client` 的对象分层
- “会话独立存在，客户端可 attach / detach / reattach”的终端生命周期模型
- 用稳定 ID、控制通知、命令查询共同支撑外部 UI / 插件 / 监控
- 把 pane 化 agent 协作建立在 tmux 兼容命令层，而不是把 agent 执行塞进单进程黑盒
- 在 Windows 语境下处理 session 发现、命名空间、warm session 这类运行时细节

## 不要急着从 psmux 借鉴什么

通常不要直接从它推导：

- Unix tmux 的全部历史语义与多 session server 设计
- 非 Windows 环境下的通用终端底层行为
- Web 前端终端布局、标签页、视觉层的最终产品形态
- 云端终端托管、多人协作同步、权限与审计模型
- 与终端无关的通用 agent orchestration 架构

## 一句话判断

如果用户目的是：

- “终端会话身份不能等同于当前客户端或当前 pane / view”
- “想参考 attach / detach / list-clients / switch-client 这类终端管理模式”
- “想看 Windows 上 tmux-compatible 的 pane 化 agent / terminal session 管理”

那么 `psmux` 应该进入优先参考源集合。
