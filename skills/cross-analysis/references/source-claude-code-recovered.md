# Claude Code 2.1.88 Recovered

本文件是 `Claude Code 2.1.88 Recovered` 的本地化搜索指南，不是官方 Claude Code 产品说明。

它的目标是帮助 Agent 在遇到相关目的时，快速判断：

- 这个参考源值不值得纳入交叉分析
- 应该先从哪些入口开始检索
- 哪些主题适合参考它
- 哪些主题不应把它当作主参考

## 适合优先参考的目的

当用户目的涉及以下方向时，优先考虑 `Claude Code 2.1.88 Recovered`：

- 对照 Claude Code-like coding agent 的 CLI / TUI、task、tool、skills、server 模块如何在 Node 项目里组织
- 分析 sourcemap 恢复源码怎样被重组为可 `npm install` / `npm run build` / `node dist/cli.js` 的研究仓库
- 研究 recovered source 与 compatibility shims / stubs 的边界应该怎样判断
- 为 Claude Code-like 机制做“教学材料 + 恢复源码 + 公开开源实现”的三方对照

## 不要把它当成主参考的情况

以下场景里，`Claude Code 2.1.88 Recovered` 通常不应作为唯一主参考：

- 需要确认 Anthropic 官方 Claude Code 的真实最新实现、产品行为或私有集成
- 需要无需权限即可直接浏览的公开源码入口
- 需要把 recovered repo 当作可直接发布或高保真复刻的生产基线
- 需要判断 `2.1.88` 之后的新机制

说明：

- 这里写的是“参考价值边界”，不是项目优劣判断。
- 这个仓库当前是 `exomind-team/claude-code` 私有仓库；未登录或无权限时，GitHub 页面可能直接返回 `404`。
- 它更适合作为“Recovered 结构线索 + 可构建研究样本”，不是官方上游真相。

## 优先检索入口

### 1. 仓库总入口与说明

- GitHub 仓库：`https://github.com/exomind-team/claude-code`
- README：`https://github.com/exomind-team/claude-code/blob/dev/README.md`
- 中文 README：`https://github.com/exomind-team/claude-code/blob/dev/README.zh-CN.md`

适合先回答：

- 这个仓库到底是不是官方上游源码
- 当前恢复到什么程度、验证过哪些基本链路
- 默认构建、运行、输出物是什么

优先关注：

- recovered
- 2.1.88
- non-official upstream
- npm build
- `dist/cli.js`

### 2. 构建与恢复入口

- `package.json`：`https://github.com/exomind-team/claude-code/blob/dev/package.json`
- `scripts/build.mjs`：`https://github.com/exomind-team/claude-code/blob/dev/scripts/build.mjs`

适合先回答：

- sourcemap 恢复后的源码是如何重新编译为可运行 CLI 的
- 哪些兼容层是在 build 时注入的
- 输出目录、入口脚本与本地安装方式如何组织

如果目的是 `恢复流程`、`兼容层`、`构建链`，优先检索这些关键词：

- build.mjs
- `bun:*` shims
- alias rewrite
- generated stubs
- compatibility layers

### 3. 源码目录入口

- `src/`：`https://github.com/exomind-team/claude-code/tree/dev/src`
- `vendor/`：`https://github.com/exomind-team/claude-code/tree/dev/vendor`

适合先回答：

- recovered 项目里有哪些主要模块面
- task / tool / skills / coordinator / server 这些语义大概落在哪
- 哪些能力依赖本地兼容替代，而不是恢复出的原始实现

如果目的是：

- 看 CLI / TUI 分层：先看 `src/main.tsx`、`src/cli/`、`src/components/`、`src/screens/`
- 看 task / tool / skills 面：先看 `src/tasks/`、`src/tools/`、`src/skills/`、`src/coordinator/`
- 看缺失私有依赖与补洞方式：先看 `vendor/` 与 `scripts/build.mjs`

### 4. 访问前提与补充入口

- 认证查看仓库信息：`gh repo view exomind-team/claude-code`
- 认证读取文件：`gh api repos/exomind-team/claude-code/contents/...`
- 远端探测：`git ls-remote https://github.com/exomind-team/claude-code.git`

适合先回答：

- 当前浏览器 404 是不是仓库不存在
- 默认分支是什么
- 是否具备继续下钻源码的访问条件

## 面向常见目的的检索路线

### 目的：先判断这个 recovered 仓库是否值得纳入交叉分析

建议路线：

1. 先看 `README.md` 或 `README.zh-CN.md`
2. 再看 `package.json`
3. 最后确认 `src/` 与 `vendor/` 是否覆盖你关心的模块面

重点想确认的问题：

- 它是官方上游、镜像，还是 recovered research repo
- 当前是否可安装、可构建、可运行
- 它能提供“结构线索”还是“行为真相”

### 目的：分析 recovered source 的构建与兼容策略

建议路线：

1. 先看 `package.json`
2. 再看 `scripts/build.mjs`
3. 然后去 `vendor/` 看兼容替代与 stub

重点想确认的问题：

- build 阶段做了哪些重写
- 哪些模块是恢复出的，哪些是补的
- 哪些行为因此不适合外推为官方实现

### 目的：把它作为 Claude Code-like 源码结构样本来对照

建议路线：

1. 先看 `src/main.tsx`、`src/commands.ts`、`src/tasks.ts`、`src/tools.ts`
2. 再按需要下钻 `src/tasks/`、`src/tools/`、`src/skills/`、`src/server/`
3. 必要时回看 `README` 和 `vendor/` 确认边界

重点想确认的问题：

- 核心机制在 recovered 结构里大致怎样切模块
- 哪些模块可以拿来做“命名面/分层面”参考
- 哪些模块因为恢复不完整，不应直接照搬

## 适合从 Claude Code 2.1.88 Recovered 借鉴什么

通常适合借鉴：

- 将 sourcemap 恢复结果重整为可研究仓库的组织方式
- recovered 项目里用于定位 task / tool / skills / server 的模块线索
- 用 build-time shims 与 stub 维持研究仓库可运行的补洞策略

## 不要急着从 Claude Code 2.1.88 Recovered 借鉴什么

通常不要直接从它推导：

- Anthropic 官方 Claude Code 的精确行为与最新实现
- 所有私有集成、原生能力、商业产品边界
- `2.1.88` 之后版本的机制变化

## 一句话判断

如果用户目的是：

- “我想拿到一个可构建的 Claude Code recovered 源码样本来做结构对照”
- “我想看 recovered source 如何把 CLI / task / tool / skills 模块重新整理出来”
- “我想把教学材料和公开开源实现之间，补上一个更接近 Claude Code 的源码参照”

那么 `Claude Code 2.1.88 Recovered` 应该进入优先参考源集合。
