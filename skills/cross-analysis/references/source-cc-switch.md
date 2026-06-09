# CC Switch

本文件是 `CC Switch` 的本地化搜索指南，不是项目 README 的搬运摘要。

它的目标是帮助 Agent 在遇到相关目的时，快速判断：

- 这个参考源值不值得纳入交叉分析
- 应该先从哪些入口开始检索
- 哪些主题适合参考它
- 哪些主题不应把它当作主参考

## 适合优先参考的目的

当用户目的涉及以下方向时，优先考虑 `CC Switch`：

- 分析一个桌面应用如何统一管理多个 AI coding CLI 的 provider / 配置 / MCP / prompts / skills
- 对照“本地配置真相 + live 文件写入 / 回填 + 系统托盘即时切换”这类最小侵入式配置管理模式
- 参考本地代理、热切换、故障转移、健康检查在多 provider 场景中的产品与实现组织
- 分析 `React + Tauri + Rust + SQLite` 在个人工具型桌面软件里的分层与目录入口
- 参考会话历史浏览、工作区文件编辑、用量统计如何被并入同一个 AI CLI 管理壳层

## 不要把它当成主参考的情况

以下场景里，`CC Switch` 通常不应作为唯一主参考：

- Claude Code、Codex、Gemini CLI 等官方工具本身的配置语义与认证行为考证
- 云端 agent runtime、多用户协作权限、服务端编排或远程托管架构
- 非桌面、非本地文件驱动、纯 Web 或移动端优先的产品形态
- 通用 API 网关 / 代理平台的生产级后端设计
- 中转服务生态、供应商优劣或商业策略的中立比较

说明：

- 这里写的是“参考价值边界”，不是项目优劣判断。
- `CC Switch` 更适合作为“多 AI CLI 配置编排、桌面集成、扩展同步、最小侵入式切换”的参考，而不是官方 CLI 真相源或通用云平台架构参考。

## 优先检索入口

### 1. 官方产品入口

- GitHub 仓库：`https://github.com/farion1231/cc-switch`
- 根 README：`https://github.com/farion1231/cc-switch/blob/main/README.md`
- 中文 README：`https://github.com/farion1231/cc-switch/blob/main/README_ZH.md`

适合先回答：

- `CC Switch` 的核心定位到底是什么
- 它覆盖哪些 AI CLI 工具与功能面
- 当前问题应该继续往用户手册、源码还是发布说明下钻

优先关注：

- 5 个 CLI 工具
- provider presets
- MCP / Prompts / Skills
- proxy / failover
- sessions / workspace
- system tray / cloud sync

### 2. 官方帮助文档

- 用户手册总入口：`https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/README.md`
- 中文用户手册：`https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/README.md`
- 代理专题：`https://github.com/farion1231/cc-switch/blob/main/docs/proxy-guide-zh.md`
- 发布说明目录：`https://github.com/farion1231/cc-switch/tree/main/docs/release-notes`

适合先回答：

- 功能在产品里是怎样命名与分组的
- 供应商、代理、MCP、Prompts、Skills、会话管理各自的用户语义是什么
- 某个问题更适合先看操作层文档，还是直接下钻代码

如果目的是 `供应商切换`、`MCP`、`Prompts`、`Skills`、`会话管理`、`代理接管`、`故障转移`、`配置文件`、`deep link`，优先检索这些关键词：

- providers
- proxy
- failover
- prompts
- skills
- sessions
- config files
- deeplink

### 3. 开发与架构入口

优先看这些入口：

- 前端入口：`https://github.com/farion1231/cc-switch/blob/main/src/App.tsx`
- 前端功能目录：`https://github.com/farion1231/cc-switch/tree/main/src/components`
- 后端入口：`https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/lib.rs`
- 后端服务目录：`https://github.com/farion1231/cc-switch/tree/main/src-tauri/src/services`
- 会话专题说明：`https://github.com/farion1231/cc-switch/blob/main/session-manager.md`

适合先回答：

- 前端 UI 面板如何映射到功能域
- Tauri IPC 后面的 Rust 服务层是怎样拆分的
- “数据库真相 / live 文件同步 / 应用特定配置”分别落在哪些模块

如果目的是：

- 看 provider / 面板组织：先看 `src/components/providers`、`src/components/universal`、`src/components/env`
- 看 MCP / Prompts / Skills：先看 `src/components/mcp`、`src/components/prompts`、`src/components/skills`，再看 `src-tauri/src/services/mcp.rs`、`prompt.rs`、`skill.rs`
- 看代理 / 故障转移 / 热切换：先看 `src/components/proxy`、`src-tauri/src/services/proxy.rs`、`stream_check.rs`、`model_fetch.rs`
- 看配置落地与应用差异：先看 `src-tauri/src/provider.rs`、`codex_config.rs`、`gemini_config.rs`、`openclaw_config.rs`、`opencode_config.rs`
- 看会话与工作区：先看 `src/components/sessions`、`src/components/workspace`、`src-tauri/src/session_manager`

### 4. GitHub 仓库级入口

优先看这些入口：

- 作者主页：`https://github.com/farion1231`
- Releases：`https://github.com/farion1231/cc-switch/releases`
- Changelog：`https://github.com/farion1231/cc-switch/blob/main/CHANGELOG.md`
- Issues：`https://github.com/farion1231/cc-switch/issues`
- Discussions：`https://github.com/farion1231/cc-switch/discussions`

适合先回答：

- 某项能力大致是何时进入项目的
- 当前哪些问题是已知边界、真实用户反馈，还是未来计划
- 某个功能是 README 宣传面，还是已经在版本演化中稳定沉淀

如果目的是：

- 看能力演化：先看 `CHANGELOG.md` 与 `docs/release-notes/`
- 看已知边界与真实问题：先看 `Issues`
- 看用户讨论与使用反馈：先看 `Discussions`

### 5. 社区 / 使用反馈 / 版本观察

- Discussions：`https://github.com/farion1231/cc-switch/discussions`
- Issues：`https://github.com/farion1231/cc-switch/issues`
- 最新发布页：`https://github.com/farion1231/cc-switch/releases/latest`

适合先回答：

- 某个能力是不是常被问到的高频需求
- 某种行为属于稳定能力、实验能力，还是版本切换期现象
- 用户更在意的是 provider 切换、扩展同步、代理能力，还是会话与工作区能力

优先关注这些板块：

- Discussions
- Issues
- Releases

## 面向常见目的的检索路线

### 目的：分析“多 AI CLI 的统一配置与切换壳层”

建议路线：

1. 先看 `README.md` 或 `README_ZH.md`
2. 再看 `docs/user-manual/zh/README.md` 以及 `2-providers/`、`3-extensions/`
3. 需要实现落点时，再看 `src/components/providers`、`src/components/mcp`、`src/components/skills`、`src-tauri/src/provider.rs` 与 `src-tauri/src/services/`

重点想确认的问题：

- 它把“多工具支持”和“单工具配置差异”如何拆开
- 供应商切换、统一供应商、扩展同步分别落在哪层
- SQLite 真相、live 文件写入、当前激活配置三者边界是什么

### 目的：分析“本地代理热切换 / 故障转移 / 应用接管”

建议路线：

1. 先看 `docs/proxy-guide-zh.md` 与用户手册 `4-proxy/`
2. 再看 `src/components/proxy`
3. 需要实现细节时，再看 `src-tauri/src/services/proxy.rs`、`stream_check.rs`、`model_fetch.rs`
4. 如果还要确认不同 CLI 的接管方式，再补 `codex_config.rs`、`gemini_config.rs`、`provider.rs`

重点想确认的问题：

- 本地代理、应用接管、故障转移在产品层如何区分
- 热切换、健康检查、熔断器分别由哪层负责
- 哪些能力是通用 provider 逻辑，哪些是具体 CLI 配置适配

### 目的：分析“MCP / Prompts / Skills / Sessions 的跨应用同步”

建议路线：

1. 先看用户手册 `3-extensions/` 与 `session-manager.md`
2. 再看 `src/components/mcp`、`src/components/prompts`、`src/components/skills`、`src/components/sessions`、`src/components/workspace`
3. 需要后端边界时，再看 `src-tauri/src/services/mcp.rs`、`prompt.rs`、`skill.rs`、`src-tauri/src/session_manager`
4. 若要看应用特定同步，再补 `claude_mcp.rs`、`gemini_mcp.rs`

重点想确认的问题：

- 哪些数据是跨应用共享的，哪些仍保留应用差异
- “一键安装 / 双向同步 / 回填保护”在实现上怎么分层
- 会话浏览、工作区文件、提示词与技能管理是共用壳层，还是独立子系统

## 适合从 CC Switch 借鉴什么

通常适合借鉴：

- 多个 AI CLI 之上的统一配置编排壳层
- SQLite + 设置文件 + 备份 + 原子写入的本地真相组织方式
- provider、proxy、MCP、Prompts、Skills、sessions 各自面板化的产品拆分
- “写 live 文件 + 从 live 回填”的最小侵入式同步思路
- 用 README、用户手册、release notes、源码目录共同构成检索路线的组织方式

## 不要急着从 CC Switch 借鉴什么

通常不要直接从它推导：

- 官方 CLI 工具的完整语义、认证边界与未来兼容性
- 通用云端代理平台或团队级多用户系统的后端架构
- 具体中转服务商、预设目录或商业合作位的选择
- Tauri 桌面打包、系统托盘、平台差异处理就是唯一正确路径
- 它当前的文件路径、配置格式和工具覆盖范围可以直接照搬到别的项目

## 一句话判断

如果用户目的是：

- “我想看一个桌面壳层怎样统一管理 Claude Code / Codex / Gemini CLI 等多个 AI CLI”
- “我想参考 provider 切换、MCP / Skills / Prompts 同步、会话管理怎样落在一个本地应用里”
- “我想对照本地代理热切换、故障转移、live 文件写入 / 回填这类模式”

那么 `CC Switch` 应该进入优先参考源集合。
