# OpenAI Codex

本文件是 `OpenAI Codex` 的本地化搜索指南，不是 Codex 全产品线百科。

它的目标是帮助 Agent 在遇到相关目的时，快速判断：

- 这个参考源值不值得纳入交叉分析
- 应该先从哪些入口开始检索
- 哪些主题适合参考它
- 哪些主题不应把它当作主参考

## 适合优先参考的目的

当用户目的涉及以下方向时，优先考虑 `OpenAI Codex`：

- 分析公开开源的 coding agent CLI / harness 如何组织文档、配置、源码与 SDK
- 对照 sandbox、approval、exec、skills、AGENTS project docs、MCP 这些机制在公开源码里如何落地
- 分析一个 agent 项目如何同时维护 `legacy TypeScript CLI` 与 `maintained Rust CLI`
- 分析“仓库 README + docs + monorepo crates/packages + SDK”如何形成统一检索入口

## 不要把它当成主参考的情况

以下场景里，`OpenAI Codex` 通常不应作为唯一主参考：

- 需要确认 Codex Web、ChatGPT 内 Codex 或云端后端的私有实现
- 需要把公开仓库中的行为等同为全部产品形态的真实行为
- 需要 IDE 插件、云任务编排、内部服务治理的完整闭源细节
- 需要非终端形态 agent 产品的完整 UX / 商业化策略

说明：

- 这里写的是“参考价值边界”，不是产品优劣判断。
- `openai/codex` 是公开 monorepo，但并不等于 OpenAI 所有 Codex 形态的全部实现。
- 对源码问题，它更适合作为“公开可验证的 CLI / harness / sandbox / MCP 实现参考”。

## 优先检索入口

### 1. 官方总入口

- GitHub 仓库：`https://github.com/openai/codex`
- 根 README：`https://github.com/openai/codex/blob/main/README.md`
- 官方文档入口：`https://developers.openai.com/codex`
- IDE 入口：`https://developers.openai.com/codex/ide`

适合先回答：

- Codex CLI、IDE、Web 之间怎样区分
- 仓库当前主推的安装方式和使用方式是什么
- 要深入哪条文档或源码路线

优先关注：

- CLI vs Web vs IDE
- ChatGPT sign-in
- releases
- docs
- monorepo

### 2. 官方帮助文档

- Getting Started：`https://github.com/openai/codex/blob/main/docs/getting-started.md`
- Config：`https://github.com/openai/codex/blob/main/docs/config.md`
- Install：`https://github.com/openai/codex/blob/main/docs/install.md`
- Sandbox：`https://github.com/openai/codex/blob/main/docs/sandbox.md`
- Exec：`https://github.com/openai/codex/blob/main/docs/exec.md`
- Exec Policy：`https://github.com/openai/codex/blob/main/docs/execpolicy.md`
- Skills：`https://github.com/openai/codex/blob/main/docs/skills.md`
- Authentication：`https://github.com/openai/codex/blob/main/docs/authentication.md`

适合先回答：

- sandbox / approval / exec 模型如何命名和暴露
- project docs / `AGENTS.md` / skills 这些概念如何进入用户心智
- 配置、认证、非交互执行、MCP 等主题该先看哪层文档

如果目的是 `sandbox`、`approval`、`exec`、`skills`、`project docs`、`MCP`，优先检索这些关键词：

- sandbox_mode
- exec
- execpolicy
- skills
- AGENTS.md
- mcp

### 3. 源码入口

- 当前维护实现说明：`https://github.com/openai/codex/blob/main/codex-rs/README.md`
- Rust 工作区：`https://github.com/openai/codex/tree/main/codex-rs`
- Legacy TypeScript CLI：`https://github.com/openai/codex/tree/main/codex-cli`
- TypeScript SDK：`https://github.com/openai/codex/tree/main/sdk/typescript`
- Python SDK：`https://github.com/openai/codex/tree/main/sdk/python`

适合先回答：

- 当前维护中的 CLI 核心到底在哪个实现上
- Rust CLI 与 legacy TS CLI 的分工边界是什么
- SDK、MCP、core、exec、tui、cli 这些能力分别落在哪

如果目的是：

- 看当前维护实现：先看 `codex-rs/README.md`、`codex-rs/core/`、`codex-rs/exec/`、`codex-rs/tui/`、`codex-rs/cli/`
- 看 TS -> Rust 演化：先看根 `README`，再看 `codex-cli/README.md` 与 `codex-rs/README.md`
- 看集成接口：先看 `sdk/`，再看 `codex-rs/codex-mcp/`、`codex-rs/mcp-server/`

### 4. 发布与仓库级入口

- Releases：`https://github.com/openai/codex/releases`
- 仓库级 AGENTS：`https://github.com/openai/codex/blob/main/AGENTS.md`
- Contributing：`https://github.com/openai/codex/blob/main/docs/contributing.md`

适合先回答：

- 哪些内容是面向最终用户，哪些是面向贡献者
- 仓库对代理行为、贡献流程、发布方式的约束是什么
- 某个行为是产品文档说的，还是仓库协作规则说的

## 面向常见目的的检索路线

### 目的：快速理解公开 Codex CLI 的机制全景

建议路线：

1. 先看根 `README.md`
2. 再看 `docs/getting-started.md`、`docs/config.md`、`docs/install.md`
3. 然后去 `codex-rs/README.md`
4. 必要时再下钻 `codex-rs/core/`、`exec/`、`tui/`、`cli/`

重点想确认的问题：

- 当前主维护实现是哪个
- 用户入口、配置入口、源码入口怎样互相衔接
- 哪些功能是公开 CLI 范围，哪些不在这个仓库里

### 目的：围绕 sandbox / approval / skills / project docs 做实现对照

建议路线：

1. 先看 `docs/sandbox.md`、`docs/exec.md`、`docs/execpolicy.md`、`docs/skills.md`
2. 再看 `docs/config.md` 中对应配置项
3. 然后去 `codex-rs/` 里找相关 crate 或目录
4. 必要时回看仓库级 `AGENTS.md`

重点想确认的问题：

- 文档里的术语和源码里的模块名是否一致
- 哪些机制是配置层、运行层、交互层分别负责
- 哪些边界是公开说明了的，哪些仍需谨慎推断

### 目的：分析 TS CLI 与 Rust CLI 的演化关系

建议路线：

1. 先看根 `README.md`
2. 再看 `codex-cli/README.md`
3. 然后看 `codex-rs/README.md`
4. 必要时分别下钻 `codex-cli/` 与 `codex-rs/`

重点想确认的问题：

- 哪个实现是 legacy，哪个是 maintained
- 两套实现各自承载哪些能力与历史包袱
- 哪些机制应该以当前 Rust 实现为准

## 适合从 OpenAI Codex 借鉴什么

通常适合借鉴：

- 把 README、主题 docs、monorepo 源码和 SDK 串成统一检索路线的组织方式
- 对 sandbox、approval、skills、project docs、MCP 的公开文档化方式
- 同时维护 legacy 实现与当前主实现时的入口分层
- 用 `core / exec / tui / cli` 分开运行逻辑、非交互执行与终端 UI 的方式

## 不要急着从 OpenAI Codex 借鉴什么

通常不要直接从它推导：

- Codex Web 或云端服务的完整实现
- OpenAI 内部安全治理、策略系统、发布流程的全部细节
- 任何 agent 产品都必须遵循的唯一架构

## 一句话判断

如果用户目的是：

- “我想看一个公开开源的 coding agent CLI / harness 是怎么组织文档和源码的”
- “我想对照 sandbox / exec / skills / AGENTS / MCP 这些机制在公开源码里的落点”
- “我想比较 legacy TS CLI 与当前 Rust CLI 的演化路径”

那么 `OpenAI Codex` 应该进入优先参考源集合。
