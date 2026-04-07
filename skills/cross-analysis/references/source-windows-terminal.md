# Windows Terminal / OpenConsole

本文件是 `Windows Terminal / OpenConsole` 的本地化搜索指南，不是产品百科。

它的目标是帮助 Agent 在遇到相关目的时，快速判断：

- 这个参考源值不值得纳入交叉分析
- 应该先从哪些入口开始检索
- 哪些主题适合参考它
- 哪些主题不应把它当作主参考

这里把两者合并成一组参考源：

- `Windows Terminal` 更适合看 `tab / pane / window / action / settings / restore` 这一层
- `OpenConsole` 更适合看 `conhost.exe`、`OpenConsole.exe`、ConPTY 与 Windows 兼容边界

## 适合优先参考的目的

当用户目的涉及以下方向时，优先考虑 `Windows Terminal / OpenConsole`：

- 终端 `pane / tab` 树如何被表达成一串可执行动作，再被启动或恢复重放
- 多窗口终端如何用 `startupActions`、`wt` 命令链、`actions`、`--window` 组织布局与焦点
- 想分析“恢复布局”为什么更适合持久化 `profile / pane 拓扑 / cwd / 焦点动作`，而不是临时 pane id
- Windows 平台下终端 UI 层与 `console host / ConPTY` 层怎样分工
- 需要一个既有官方文档入口、又能继续落到源码目录的终端布局参考源

## 不要把它当成主参考的情况

以下场景里，`Windows Terminal / OpenConsole` 通常不应作为唯一主参考：

- `tmux / psmux` 式的 detached session、server 端持活、client attach / detach 模型
- Shell 进程内容、buffer 内容、进程树状态的完整恢复
- 跨平台终端前端框架或 Web 技术栈下的终端 UI 实现
- 插件生态、脚本 API、第三方扩展机制本身
- 多用户远程协作、Agent runtime 编排、服务端会话治理

说明：

- 这里写的是“参考价值边界”，不是产品优劣判断。
- 对“布局恢复动作模型”，它更适合作为 `Windows Terminal` 参考；对“底层 host / ConPTY / conhost 边界”，它更适合作为 `OpenConsole` 参考。
- 官方文档明确写到 `persistedWindowLayout` 保存的是窗口位置、tab/pane 布局、profile 与可报告的 cwd，不保存 pane 内容；不要把它误读成 `tmux` 式会话恢复。

## 优先检索入口

### 1. 官方产品入口

- 总入口：`https://learn.microsoft.com/en-us/windows/terminal/`

适合先回答：

- 官方把哪些概念明确叫做 `window / tab / pane / action / startup`
- 这是“终端布局与动作模型”参考，还是“完整会话持久化”参考
- `Windows Terminal` 与 `Windows Console Host` 的产品边界是什么

优先关注：

- Startup
- Command line arguments
- Panes
- Actions
- Quake mode

### 2. 官方帮助文档

- 启动与恢复：`https://learn.microsoft.com/en-us/windows/terminal/customize-settings/startup`
- 命令行参数：`https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments`
- Pane 文档：`https://learn.microsoft.com/en-us/windows/terminal/panes`
- 动作文档：`https://learn.microsoft.com/en-us/windows/terminal/customize-settings/actions`
- Tips & tricks：`https://learn.microsoft.com/en-us/windows/terminal/tips-and-tricks`

适合先回答：

- `startupActions`、`firstWindowPreference = persistedWindowLayout`、`windowingBehavior` 的官方含义是什么
- `wt` 能否把一组 `new-tab / split-pane / focus-tab / move-focus / move-pane` 串成可重放的布局命令
- `globalSummon`、`quakeMode`、`--window` 这些能力怎样和多窗口复用关联起来

如果目的是 `布局恢复`、`pane/tab 树动作化`、`多窗口复用`，优先检索这些关键词：

- persistedWindowLayout
- startupActions
- split-pane
- focus-tab
- move-focus
- move-pane
- switchToTab
- --window
- windowingBehavior
- globalSummon
- quakeMode

### 3. 官方开发文档

- 主仓库 README：`https://github.com/microsoft/terminal`
- 代码组织说明：`https://github.com/microsoft/terminal/blob/main/doc/ORGANIZATION.md`

适合先回答：

- 这个仓库同时包含哪些产品与共享组件
- `Windows Terminal` 与 `OpenConsole / conhost` 的源码边界在哪里
- 如果要继续深挖，应该先看 `src/cascadia/TerminalApp` 还是 `src/host`

### 4. GitHub 组织与仓库

优先看这些仓库：

- 组织页：`https://github.com/microsoft`
- 主仓库：`https://github.com/microsoft/terminal`
- 文档仓库：`https://github.com/MicrosoftDocs/terminal`

如果目的是：

- 看布局恢复动作模型：先看文档里的 `startup / command-line-arguments / panes / actions`，再去 `src/cascadia/TerminalApp`
- 看 pane 树与焦点动作落点：先看 `src/cascadia/TerminalApp/AppCommandlineArgs.cpp`、`Pane.cpp`、`Pane.LayoutSizeNode.cpp`、`TabManagement.cpp`、`TerminalPage.cpp`
- 看窗口复用、召回与命名窗口：先看 `TerminalWindow.cpp`、`Remoting.cpp`
- 看 `OpenConsole / conhost / ConPTY` 边界：先看 README，再去 `src/host` 与 `src/host/exe`

### 5. 社区 / 论坛 / Showcase

- 团队博客：`https://devblogs.microsoft.com/commandline/`
- Issue 搜索入口：`https://github.com/microsoft/terminal/issues`

适合先回答：

- 为什么微软把“新 Terminal”与“旧 console host”拆成两层
- 某个布局/窗口行为是公开能力、实现细节，还是历史兼容约束
- 是否已有关于 `pane`、`layout restore`、`quake`、`window reuse` 的边界讨论

优先关注这些主题词：

- ConPTY
- pseudoconsole
- panes
- startupActions
- persistedWindowLayout
- windowingBehavior
- quake
- summon

## 面向常见目的的检索路线

### 目的：把 `pane / tab` 树看成可编译、可恢复、可重放的动作序列

建议路线：

1. 先看 `startup` 文档里的 `startupActions` 与 `firstWindowPreference = persistedWindowLayout`
2. 再看 `command-line-arguments` 里的 `wt`、`new-tab`、`split-pane`、`focus-tab`、`move-focus`、`move-pane`
3. 再看 `actions` 文档里的 `wt`、`multipleActions`、`switchToTab`、`moveFocus`
4. 必要时补 `src/cascadia/TerminalApp/AppCommandlineArgs.cpp`、`Pane.cpp`、`Pane.LayoutSizeNode.cpp`、`TabManagement.cpp`、`TerminalPage.cpp`

重点想确认的问题：

- 官方允许持久化和重放的对象到底是什么
- 布局、焦点、tab 切换、pane 移动是否都被表达成动作层术语
- 恢复是不是依赖旧 pane id，还是依赖一串布局与焦点动作

### 目的：分析多窗口复用、MRU、命名窗口与 quake / summon

建议路线：

1. 先看 `startup` 文档里的 `windowingBehavior`
2. 再看 `command-line-arguments` 里的 `--window / -w` 与命名窗口行为
3. 再看 `actions` 与 `tips-and-tricks` 里的 `globalSummon`、`quakeMode`、`wt -w _quake`
4. 必要时补 `TerminalWindow.cpp`、`Remoting.cpp`、`TerminalPage.cpp`

重点想确认的问题：

- 新请求默认是开新窗口、注入现有窗口，还是按 MRU 复用
- 命名窗口与 quake window 是普通布局窗口，还是独立语义窗口
- 多窗口路由与 pane 树恢复是不是两层不同问题

### 目的：判断 `Windows Terminal` 与 `OpenConsole` 在这组参考里的分工边界

建议路线：

1. 先看主仓库 README 里的 `Terminal & Console Overview`
2. 再看 `doc/ORGANIZATION.md` 里的 `src/cascadia/TerminalApp` 与 `src/host` 说明
3. 如果是 `tab / pane / action / restore` 语义，继续看 `src/cascadia/TerminalApp`
4. 如果是 `conhost / OpenConsole / ConPTY / 默认终端` 边界，继续看 `src/host` 与相关博客

重点想确认的问题：

- `OpenConsole` 是否负责 tab/pane 布局模型
- `Windows Terminal` 与 `conhost` 分别掌握哪些“真相”
- 哪些结论应该从布局层借鉴，哪些只应作为 Windows 兼容层背景

## 适合从 Windows Terminal / OpenConsole 借鉴什么

通常适合借鉴：

- 用统一动作词汇贯穿 `settings -> wt 命令行 -> keybindings/actions -> restore`
- 把布局恢复限制在 `window / tab / pane` 拓扑、profile、cwd、焦点这一级
- 把窗口路由、MRU、命名窗口、quake/summon 与 pane 树恢复分层处理
- 明确区分 `Terminal UI` 层与 `console host / ConPTY` 层
- 先靠官方文档术语建模，再用源码入口确认实现位置

## 不要急着从 Windows Terminal / OpenConsole 借鉴什么

通常不要直接从它推导：

- `tmux` 式 detached session 或“进程继续活着，客户端随时 reattach”的模型
- Shell 内容、历史输出、pane 内状态都可完整恢复的假设
- Windows 专属窗口行为、热键、quake/summon 语义在其他平台的直接可迁移性
- `OpenConsole / conhost` 就等于 `pane / tab` UX 的误读
- C++ / WinUI / Win32 代码分层本身就是你的产品分层结论

## 一句话判断

如果用户目的是：

- “终端 `pane / tab` 树能不能被编译成动作，再用于恢复重放”
- “布局恢复应该存什么，才不会绑死在临时 pane id 上”
- “多窗口终端怎样做 `MRU / --window / named window / quake summon`”
- “`Windows Terminal` 与 `OpenConsole / conhost / ConPTY` 的边界在哪里”

那么 `Windows Terminal / OpenConsole` 应该进入优先参考源集合。
