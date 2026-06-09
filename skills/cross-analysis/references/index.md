# 参考源索引

本文件用于登记“交叉分析” skill 可优先调用的本地参考源档案。

目标不是直接充当“参考内容本体”，而是提供一个可持续扩展的本地化搜索指南：

- 告诉 Agent 相关主题通常该优先参考哪些对象
- 告诉 Agent 应从哪些入口继续检索
- 提供主题与参考源之间的链接性语义

## 使用规则

1. 做交叉分析时，先读本文件。
2. 若这里已经有与用户目的高度相关的参考源，优先使用本地档案。
3. 只有本地档案不足时，才继续补 GitHub 项目、搜索型 skill 或网页搜索。
4. 若需要新增参考源，先参考 [template.md](./template.md)。

## 推荐记录格式

每个参考源建议至少记录：

- 名称
- 主题标签
- 适用目的
- 适用问题
- 本地档案位置
- 检索入口 / 线索
- 若需要补外部资料，优先看什么

## 新增参考源时建议补什么

建议至少补两部分：

1. 在本索引中登记条目
2. 为该参考源新增独立档案

独立档案里建议写：

- 这个参考源最适合回答什么问题
- 它的强项是什么
- 它不适合作为什么主题的参考
- 如果 Agent 要继续深挖，应该先去哪里找
- 若要继续外查，优先看哪些源码或官方资料

建议直接基于：

- [template.md](./template.md)

来生成新的参考源档案，保证结构稳定。

## 当前状态

当前索引已加入多条真实参考源，作为结构验证：

## 权限受限参考源

有些本地参考源本身对应的外部对象并不是稳定公开可读的。

这类对象可以保留在索引中，但运行态使用时要额外判断：

- 当前环境是否具备访问权限
- 浏览器 `404` 是对象不存在，还是私有仓库 / 权限不足
- 若当前不可访问，是否应退回到同主题下的公开参考源

默认处理方式：

- 可以把它们当作“条件性参考源”
- 可以用来提示 Agent 某条参考路径存在
- 但不要把它们当作所有人都可稳定复用的公开入口

## 复合目的联查入口

当问题直接围绕 `ExoMind / 外心` 当前实现时，先查内部参考：

- 当前仓库里的代码、文档、网站页面
- 当前 issue、PR、计划文档
- 当前 GitHub 上已存在的公开内容

再根据目的，联看下面这些本地参考源：

### 外心官网 / 用户教程 / 应用内文档怎么组织

建议组合：

- 内部参考
- [source-learn-claude-code.md](./source-learn-claude-code.md)
- [source-obsidian.md](./source-obsidian.md)

优先回答：

- 当前外心已经有哪些用户向文档与官网入口
- 教程站、手册、README、应用内文档该如何分层
- 概念词汇、用户心智模型、渐进式学习路径该参考什么

如果本地参考源还不够，再补外部帮助中心 / 教程站类网站项目。

### 任务依赖图 / DAG / 白板页面交互怎么优化

建议组合：

- 内部参考
- [source-react-flow.md](./source-react-flow.md)
- [source-obsidian.md](./source-obsidian.md)

优先回答：

- 外心当前依赖图或白板页面已经怎么做
- 节点、边、viewport、交互状态的实现边界该参考什么
- 白板式对象编排、局部视角、连接创建心智该参考什么

### 终端会话生命周期 / 历史恢复 / 视图绑定如何设计

建议组合：

- 内部参考
- [source-psmux.md](./source-psmux.md)
- [source-tmux.md](./source-tmux.md)
- [source-windows-terminal.md](./source-windows-terminal.md)

优先回答：

- 外心当前已经有哪些 PTY、恢复、布局与视图绑定能力
- 会话身份、当前实例、client / pane / view 语义该怎样拆层
- pane / tab / window 布局恢复与 detach / reattach / control model 应分别参考什么

### Claude Code-like agent 教程 / 机制手册 / 参考实现如何组织

建议组合：

- 内部参考
- [source-learn-claude-code.md](./source-learn-claude-code.md)
- [source-claude-code-recovered.md](./source-claude-code-recovered.md)
- [source-codex.md](./source-codex.md)

优先回答：

- 外心当前已有的 agent 文档、网站与产品入口怎样分层
- 教学站、session 手册、恢复源码、公开开源源码该怎样组织成学习链
- 哪些内容适合写成教学式机制文档，哪些应保留为运行时或实现文档
- 当需要对照 Claude Code-like 真实源码结构时，应该优先看 recovered 样本还是公开 Codex 源码

如果当前环境无法访问权限受限的 recovered 仓库，就先退回：

- [source-learn-claude-code.md](./source-learn-claude-code.md)
- [source-codex.md](./source-codex.md)

### 版本控制 / 操作日志 / 数据版本管理如何设计

建议组合：

- 内部参考
- [source-jj.md](./source-jj.md)

优先回答：

- 外心当前在哪些层已经有历史、恢复、撤销或版本痕迹
- `working copy / snapshot / operation log / undo / bookmark` 这些概念怎样拆边界
- Git-compatible 存储与更高层 metadata 分离时，哪些路径值得借鉴

### 桌面应用的设置 / 配置 / 扩展 / 自动更新等通用能力怎么组织

建议组合：

- 内部参考
- [source-cc-switch.md](./source-cc-switch.md)
- [source-weflow.md](./source-weflow.md)

优先回答：

- 设置、配置、系统托盘、安装包、平台差异、自动更新这类桌面通用能力该如何分层
- 哪些能力更适合做成“本地真相 + live 文件同步”，哪些更适合直接内建在应用数据层
- 本地优先桌面工具如何同时组织业务功能、设置面板、扩展能力与本地服务接口

## 已登记参考源

### Obsidian

- 主题标签：
  - 本地优先笔记
  - Markdown 工作流
  - 双链知识组织
  - 图谱视图
  - Canvas
  - 插件生态
- 适用目的：
  - 分析“本地化笔记”应优先参考哪些成熟做法
  - 分析“知识组织 / 双链 / 图谱 / Canvas”如何组合
  - 分析“核心能力 + 插件生态”如何分层
- 适用问题：
  - 本地优先与开放格式如何成为产品定位
  - 图谱在知识系统中是主组织工具还是辅助视图
  - 个人知识工作流怎样围绕插件生态扩展
- 本地档案位置：
  - [source-obsidian.md](./source-obsidian.md)
- 检索入口 / 线索：
  - 官网：`https://obsidian.md/`
  - 帮助文档：`https://obsidian.md/help/`
  - 开发文档：`https://docs.obsidian.md/`
  - GitHub 组织：`https://github.com/obsidianmd`
  - 论坛：`https://forum.obsidian.md/`
- 若需要补外部资料，优先看什么：
  - 产品定位先看官网与帮助文档
  - 插件与 API 先看开发文档与 `obsidian-api`
  - 生态边界先看 `obsidian-releases`

### React Flow

- 主题标签：
  - 节点编辑器
  - DAG / workflow 画布
  - viewport 交互
  - edge / node renderer
  - hooks / API
  - React 画布扩展
- 适用目的：
  - 分析 React 技术栈下的 DAG / workflow / node editor 如何实现
  - 分析 viewport、节点、边、自定义 renderer 的分层方式
  - 分析图编辑器能力如何通过 hooks、provider、instance helper 暴露
- 适用问题：
  - 节点、边、viewport 的实现边界通常怎样划分
  - 自定义节点、自定义边、handle、交互状态通常落在哪些接口
  - 画布交互、样式扩展与业务语义如何解耦
- 本地档案位置：
  - [source-react-flow.md](./source-react-flow.md)
- 检索入口 / 线索：
  - 官网 / 文档：`https://reactflow.dev/`
  - Learn：`https://reactflow.dev/learn`
  - API Reference：`https://reactflow.dev/api-reference`
  - GitHub 仓库：`https://github.com/xyflow/xyflow`
  - Examples：`https://reactflow.dev/examples`
- 若需要补外部资料，优先看什么：
  - 能力边界先看官网与 Learn
  - 稳定接口先看 API Reference
  - 真实实现位置先看 `xyflow/xyflow` 的 `packages/react` 与 `examples/react`

### Learn Claude Code

- 主题标签：
  - Claude Code-like agent
  - harness engineering
  - coding agent 教程
  - 用户手册
  - skills / subagents / tasks
  - worktree isolation
  - 教学式参考实现
- 适用目的：
  - 分析 Claude Code-like agent 如何以“教程站点 + 手册 + 参考实现”形式讲清机制
  - 分析 tools、todo、skills、compact、tasks、teams、worktree isolation 等机制如何被渐进拆解
  - 分析一个 agent 学习项目如何同时组织站点入口、README、session 手册与代码仓库
- 适用问题：
  - 某个机制应该先看教程页、手册页还是参考实现
  - 教学参考与生产真相之间的边界该怎样判断
  - 多语言文档、互动站点、代码示例如何互相导流
- 本地档案位置：
  - [source-learn-claude-code.md](./source-learn-claude-code.md)
- 检索入口 / 线索：
  - 官网：`https://learn.shareai.run/`
  - Timeline：`https://learn.shareai.run/en/timeline/`
  - Layers：`https://learn.shareai.run/en/layers/`
  - Compare：`https://learn.shareai.run/en/compare/`
  - GitHub 仓库：`https://github.com/shareAI-lab/learn-claude-code`
  - README：`https://github.com/shareAI-lab/learn-claude-code/blob/main/README.md`
  - 英文手册：`https://github.com/shareAI-lab/learn-claude-code/tree/main/docs/en`
  - 中文手册：`https://github.com/shareAI-lab/learn-claude-code/tree/main/docs/zh`
- 若需要补外部资料，优先看什么：
  - 先看 `Timeline / Layers` 把 12 个 session 的范围跑通
  - 再看 `README` 与 `docs/en|zh` 确认具体术语、scope 与用户手册表达
  - 若要定位实现，再看 `agents/`、`skills/`、`web/` 与 sister repos `Kode-cli`、`Kode-agent-sdk`、`claw0`

### Claude Code 2.1.88 Recovered

- 主题标签：
  - Claude Code source
  - recovered source
  - coding agent CLI
  - TUI / task / tool / skills
  - sourcemap reconstruction
  - Node/npm build pipeline
- 适用目的：
  - 分析 Claude Code-like coding agent 的 recovered 源码结构如何组织
  - 分析 sourcemap 恢复项目怎样被重新整理成可构建、可运行的研究仓库
  - 对照教学材料、recovered 样本与公开开源实现之间的边界
- 适用问题：
  - task / tool / skills / server / screen 等语义在 recovered 项目里大概落在哪
  - build-time shims、stubs 与兼容层怎样影响“源码真相”的判断
  - 当官方源码不可得时，recovered source 在交叉分析里能承担什么角色
- 本地档案位置：
  - [source-claude-code-recovered.md](./source-claude-code-recovered.md)
- 检索入口 / 线索：
  - GitHub 仓库：`https://github.com/exomind-team/claude-code`
  - README：`https://github.com/exomind-team/claude-code/blob/dev/README.md`
  - 中文 README：`https://github.com/exomind-team/claude-code/blob/dev/README.zh-CN.md`
  - 构建脚本：`https://github.com/exomind-team/claude-code/blob/dev/scripts/build.mjs`
  - 源码目录：`https://github.com/exomind-team/claude-code/tree/dev/src`
  - 兼容层目录：`https://github.com/exomind-team/claude-code/tree/dev/vendor`
- 若需要补外部资料，优先看什么：
  - 先看 `README` 确认它是 recovered project，不是官方上游
  - 再看 `package.json` 与 `scripts/build.mjs` 判断恢复与兼容策略
  - 若要找模块面，再看 `src/` 下的 `tasks/`、`tools/`、`skills/`、`server/`

### OpenAI Codex

- 主题标签：
  - coding agent CLI
  - harness engineering
  - sandbox / approval
  - exec / MCP / skills
  - AGENTS project docs
  - Rust + TypeScript monorepo
- 适用目的：
  - 分析公开开源 coding agent CLI / harness 的文档与源码组织
  - 分析 sandbox、approval、exec、skills、MCP、project docs 等机制的公开实现
  - 分析 legacy TypeScript CLI 与当前 Rust CLI 的演化关系
- 适用问题：
  - 当前维护中的 CLI 真实入口在哪
  - 文档里的术语怎样映射到 `core / exec / tui / cli / sdk`
  - 公开仓库能覆盖哪些 Codex 形态，哪些不在范围内
- 本地档案位置：
  - [source-codex.md](./source-codex.md)
- 检索入口 / 线索：
  - GitHub 仓库：`https://github.com/openai/codex`
  - README：`https://github.com/openai/codex/blob/main/README.md`
  - 官方文档：`https://developers.openai.com/codex`
  - Rust CLI：`https://github.com/openai/codex/tree/main/codex-rs`
  - Legacy TS CLI：`https://github.com/openai/codex/tree/main/codex-cli`
  - SDK：`https://github.com/openai/codex/tree/main/sdk`
- 若需要补外部资料，优先看什么：
  - 先看根 `README` 和 `docs/` 确认用户入口与概念命名
  - 再看 `codex-rs/README.md` 与 `core / exec / tui / cli`
  - 若要看演化路径，再补 `codex-cli/README.md`

### Jujutsu / jj

- 主题标签：
  - version control
  - data version management
  - operation log
  - undo
  - working-copy-as-a-commit
  - Git-compatible VCS
- 适用目的：
  - 分析版本控制 / 数据版本管理的对象模型与操作日志设计
  - 分析 working copy、snapshot、undo、conflict object 如何统一成一套语义
  - 分析 Git-compatible 存储层与高层 metadata 如何拆边界
- 适用问题：
  - operation log 与内容版本分别负责什么
  - 冲突为什么要被提升为第一类对象
  - Git backend、bookmark、revset、colocated workflow 各自提供什么参考价值
- 本地档案位置：
  - [source-jj.md](./source-jj.md)
- 检索入口 / 线索：
  - GitHub 仓库：`https://github.com/jj-vcs/jj`
  - 官网：`https://www.jj-vcs.dev`
  - 教程：`https://docs.jj-vcs.dev/latest/tutorial`
  - Git Comparison：`https://docs.jj-vcs.dev/latest/git-comparison`
  - Operation Log：`https://docs.jj-vcs.dev/latest/operation-log`
  - Working Copy：`https://docs.jj-vcs.dev/latest/working-copy`
- 若需要补外部资料，优先看什么：
  - 先看 `tutorial`、`git-comparison`、`working-copy` 建立心智
  - 再看 `operation-log`、`conflicts`、`git-compatibility` 判断版本语义与边界
  - 若要下钻实现，再看 `docs/core_tenets.md`、`docs/design/`、`docs/technical/`

### WeFlow

- 主题标签：
  - local-first desktop app
  - 微信聊天记录
  - 导出 / 分析 / 年报
  - 本地 HTTP API
  - Electron + React
  - 隐私优先
- 适用目的：
  - 分析本地优先桌面产品如何包装查看、导出、分析、报告与本地 API
  - 分析 Electron 桌面工具如何组织前端壳层、本地服务与数据解析能力
  - 分析隐私敏感数据“纯本地处理、不依赖云端”的产品表达与能力边界
- 适用问题：
  - 本地服务、导出能力、分析能力、桌面通知等通用桌面能力怎样和业务模块组合
  - 聊天数据怎样映射为本地 HTTP API 给自动化或 AI 工具接入
  - 官网、GitHub、技术研究站怎样形成多层入口
- 本地档案位置：
  - [source-weflow.md](./source-weflow.md)
- 检索入口 / 线索：
  - 官网：`https://weflow.top/`
  - 技术研究：`https://doc.weflow.top/`
  - GitHub 仓库：`https://github.com/hicccc77/WeFlow`
  - README：`https://github.com/hicccc77/WeFlow/blob/main/README.md`
  - HTTP API：`https://github.com/hicccc77/WeFlow/blob/main/docs/HTTP-API.md`
- 若需要补外部资料，优先看什么：
  - 产品定位先看官网与 README
  - 本地 API 与桌面侧开放能力先看 `docs/HTTP-API.md`
  - 实现分层先看 `electron/services`、`src/pages` 与 `src/App.tsx`

### CC Switch

- 主题标签：
  - desktop AI CLI manager
  - settings / config
  - system tray
  - auto update
  - MCP / prompts / skills
  - Tauri + Rust + SQLite
- 适用目的：
  - 分析桌面壳层如何统一管理 Claude Code、Codex、Gemini CLI 等多个 AI CLI
  - 分析 provider、proxy、MCP、Prompts、Skills、sessions 等通用能力如何面板化组织
  - 分析设置、配置、live 文件写入 / 回填、系统托盘、自动更新等桌面通用能力如何收口
- 适用问题：
  - 多工具配置真相、应用级接管、故障转移、热切换应分别落在哪层
  - SQLite、设置文件、备份与 live 配置文件之间怎样分工
  - 用户手册、release notes、源码目录如何形成统一检索路线
- 本地档案位置：
  - [source-cc-switch.md](./source-cc-switch.md)
- 检索入口 / 线索：
  - GitHub 仓库：`https://github.com/farion1231/cc-switch`
  - README：`https://github.com/farion1231/cc-switch/blob/main/README.md`
  - 中文 README：`https://github.com/farion1231/cc-switch/blob/main/README_ZH.md`
  - 用户手册：`https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/README.md`
  - Releases：`https://github.com/farion1231/cc-switch/releases`
- 若需要补外部资料，优先看什么：
  - 产品能力与信息架构先看 README 与用户手册
  - 设置 / 配置 / 托盘 / 更新等桌面通用能力先看 `src/components/settings`、`UpdateBadge.tsx`、release notes
  - provider / proxy / MCP / skills / sessions 的实现边界先看 `src/components/*` 与 `src-tauri/src/services/*`

### psmux

- 主题标签：
  - 终端会话管理
  - attach / detach
  - session / window / pane / client
  - control mode
  - Windows tmux-compatible
  - agent pane 协作
- 适用目的：
  - 分析终端会话身份如何从当前客户端或当前视图中拆出来
  - 分析 Windows 语境下 tmux-compatible 的终端管理模型
  - 分析外部程序怎样通过控制协议驱动、观测、绑定终端会话
- 适用问题：
  - 会话、客户端、pane、视图占用之间通常怎样分层
  - attach / detach / reattach、`list-clients`、`switch-client` 这类能力怎样组织
  - warm session、agent pane 团队、历史会话与当前实例分离该参考什么
- 本地档案位置：
  - [source-psmux.md](./source-psmux.md)
- 检索入口 / 线索：
  - 官网：`https://psmux.pages.dev/`
  - GitHub 仓库：`https://github.com/psmux/psmux`
  - docs：`https://github.com/psmux/psmux/tree/master/docs`
  - control mode：`https://github.com/psmux/psmux/blob/master/docs/control-mode.md`
  - scripting：`https://github.com/psmux/psmux/blob/master/docs/scripting.md`
- 若需要补外部资料，优先看什么：
  - 对象模型先看 `README`、`docs/features.md` 与 `src/types.rs`
  - 控制协议先看 `docs/control-mode.md`、`docs/scripting.md`
  - 会话恢复与 warm session 先看 `docs/warm-sessions.md` 与 `src/server/mod.rs`

### tmux

- 主题标签：
  - terminal multiplexer
  - session / window / pane / client
  - attach / detach / reattach
  - control mode
  - target 语法
  - server / client 模型
- 适用目的：
  - 分析终端 runtime 如何把 session、window、pane、client 拆成稳定对象层
  - 分析会话如何脱离当前客户端持续存在并支持 reattach
  - 分析宿主应用如何基于 list / capture / send / subscribe 构建终端控制面
- 适用问题：
  - session 与 client 的边界通常怎样定义
  - server 如何统一管理 session / window / pane / client
  - 稳定 ID、target 语法、脚本控制面如何组织
- 本地档案位置：
  - [source-tmux.md](./source-tmux.md)
- 检索入口 / 线索：
  - GitHub 仓库：`https://github.com/tmux/tmux`
  - Getting Started：`https://github.com/tmux/tmux/wiki/Getting-Started`
  - FAQ：`https://github.com/tmux/tmux/wiki/FAQ`
  - 权威手册：`https://man.openbsd.org/tmux`
  - 手册源码：`https://github.com/tmux/tmux/blob/master/tmux.1`
- 若需要补外部资料，优先看什么：
  - 术语与对象边界先看 `Getting Started`
  - attach / detach / session 生命周期先看 `tmux.1`
  - control mode、formats、源码落点先看 `Advanced-Use`、`control.c`、`server-client.c`

### Windows Terminal / OpenConsole

- 主题标签：
  - terminal layout restore
  - pane / tab / window
  - startupActions
  - wt command line
  - OpenConsole / conhost / ConPTY
  - MRU / quake / named window
- 适用目的：
  - 分析终端 pane / tab 树如何被编译成动作并用于恢复重放
  - 分析多窗口终端如何组织 `startupActions`、`wt`、`actions` 与窗口路由
  - 分析 Windows Terminal UI 层与 OpenConsole / conhost / ConPTY 的边界
- 适用问题：
  - 布局恢复应该持久化什么，才不会绑死在临时 pane id 上
  - 多窗口复用、`--window`、命名窗口、quake summon 这类行为怎样组织
  - 哪些能力属于布局层参考，哪些只是 Windows 兼容层背景
- 本地档案位置：
  - [source-windows-terminal.md](./source-windows-terminal.md)
- 检索入口 / 线索：
  - 总入口：`https://learn.microsoft.com/en-us/windows/terminal/`
  - Startup：`https://learn.microsoft.com/en-us/windows/terminal/customize-settings/startup`
  - Command line arguments：`https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments`
  - Panes：`https://learn.microsoft.com/en-us/windows/terminal/panes`
  - 主仓库：`https://github.com/microsoft/terminal`
- 若需要补外部资料，优先看什么：
  - 布局恢复与动作模型先看 `startup`、`command-line-arguments`、`actions`
  - pane 树与焦点动作落点先看 `src/cascadia/TerminalApp`
  - `OpenConsole / conhost / ConPTY` 边界先看仓库 README 与 `src/host`
