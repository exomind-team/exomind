# Learn Claude Code

本文件是 `Learn Claude Code` 的本地化搜索指南，不是网站简介页摘要。

它的目标是帮助 Agent 在遇到相关目的时，快速判断：

- 这个参考源值不值得纳入交叉分析
- 应该先从哪些入口开始检索
- 哪些主题适合参考它
- 哪些主题不应把它当作主参考

## 适合优先参考的目的

当用户目的涉及以下方向时，优先考虑 `Learn Claude Code`：

- 教学式理解 Claude Code-like coding agent / harness engineering
- 围绕工具、计划、skills、compact、tasks、agent teams、worktree isolation 等机制做分层对照
- 分析“教程站点 + 用户手册 + 参考实现 + 源码仓库”如何被组织成一个统一学习入口
- 分析如何把复杂 agent 机制拆成渐进式 session，让读者按阶段理解
- 为自己的 agent 项目设计学习路径、机制手册或 onboarding 教程

## 不要把它当成主参考的情况

以下场景里，`Learn Claude Code` 通常不应作为唯一主参考：

- 需要确认 Anthropic 官方 Claude Code 的真实实现、准确行为或最新私有机制
- 需要 production 级权限治理、完整事件总线、resume / fork 生命周期或完整 MCP runtime 细节
- 需要商业产品级 UX、定价、发布策略或企业交付形态参考
- 需要非 coding agent 领域的完整行业实现细节

说明：

- 这里写的是“参考价值边界”，不是项目优劣判断。
- 对实现问题，`Learn Claude Code` 更适合作为“教学拆解 + 用户手册 + 参考实现”参考，而不是“官方规范”或“生产真相”参考。

## 优先检索入口

### 1. 官方产品入口

- 官网：`https://learn.shareai.run/`
- Timeline：`https://learn.shareai.run/en/timeline/`
- Layers：`https://learn.shareai.run/en/layers/`
- Compare：`https://learn.shareai.run/en/compare/`

适合先回答：

- 这套学习站点怎样组织整体学习路径
- `s01` 到 `s12` 分别对应哪些 agent mechanism
- 某个机制属于 Tools、Planning、Memory、Concurrency 还是 Collaboration

优先关注：

- timeline
- layers
- compare
- s01-s12
- motto / session ordering

### 2. 官方帮助文档

- 仓库 README：`https://github.com/shareAI-lab/learn-claude-code/blob/main/README.md`
- 中文 README：`https://github.com/shareAI-lab/learn-claude-code/blob/main/README-zh.md`
- 英文手册目录：`https://github.com/shareAI-lab/learn-claude-code/tree/main/docs/en`
- 中文手册目录：`https://github.com/shareAI-lab/learn-claude-code/tree/main/docs/zh`

适合先回答：

- 某个 session 解决的核心问题是什么
- 官方如何给每个机制命名、分层和写教学文案
- 如果要看中文术语或英文原词，应该去哪一层文档对照

如果目的是 `skill loading`、`subagents`、`task system`、`background tasks`、`agent teams`、`worktree isolation`，优先检索这些关键词：

- s05 skill loading
- s06 context compact
- s07 task system
- s08 background tasks
- s09 agent teams
- s12 worktree task isolation

### 3. 官方开发文档

- 主仓库：`https://github.com/shareAI-lab/learn-claude-code`
- Python 参考实现：`https://github.com/shareAI-lab/learn-claude-code/tree/main/agents`
- skills 示例：`https://github.com/shareAI-lab/learn-claude-code/tree/main/skills`
- Web 教学站实现：`https://github.com/shareAI-lab/learn-claude-code/tree/main/web`
- tests：`https://github.com/shareAI-lab/learn-claude-code/tree/main/tests`

适合先回答：

- 某个机制在参考实现里大概落在哪
- 教学手册如何对应到最小可运行代码
- 互动式学习站点与文档仓库之间怎样互相跳转

### 4. GitHub 组织与仓库

优先看这些仓库：

- 组织页：`https://github.com/shareAI-lab`
- 核心仓库：`https://github.com/shareAI-lab/learn-claude-code`
- Kode Agent CLI：`https://github.com/shareAI-lab/Kode-cli`
- Kode Agent SDK：`https://github.com/shareAI-lab/Kode-agent-sdk`
- claw0：`https://github.com/shareAI-lab/claw0`

如果目的是：

- 学习 0->1 教学拆解：先看 `learn-claude-code`
- 看“可安装 CLI”方向：再看 `Kode-cli`
- 看“嵌入式 SDK”方向：再看 `Kode-agent-sdk`
- 看“always-on assistant”方向：再看 `claw0`

### 5. 生态 / 延伸入口

- 站内 Compare：`https://learn.shareai.run/en/compare/`
- Sister repo 说明入口：`https://github.com/shareAI-lab/learn-claude-code/blob/main/README.md`

适合先回答：

- 这个项目想和哪些对象形成对照
- 教学仓库和部署型工具、常驻型助手之间的边界在哪里
- 若要从“学机制”延伸到“做产品”，下一跳应看哪里

优先关注这些延伸方向：

- Kode CLI
- Kode Agent SDK
- claw0
- learning repo vs shipping repo

## 面向常见目的的检索路线

### 目的：快速理解 Claude Code-like agent 的机制全景

建议路线：

1. 先看 `Timeline`
2. 再看 `Layers` 与 `Compare`
3. 然后读 `README` 和对应语言的 `docs/*`
4. 必要时再下钻到 `agents/` 里的参考实现

重点想确认的问题：

- 12 个 session 分别覆盖什么
- 教学站把哪些机制归到哪一层
- 哪些内容是教学化简，哪些不在范围内

### 目的：围绕某个具体机制做交叉分析

建议路线：

1. 先在 `Timeline` 找到对应 session
2. 再读 `docs/en` 或 `docs/zh` 对应手册
3. 然后去 `agents/`、`skills/`、`tests/` 找最小实现位置
4. 若要看边界，再回到 `README` 的 scope 与 sister repo 说明

重点想确认的问题：

- 该机制的最小可运行形态是什么
- 文档、代码、教学页面之间怎样一一对应
- 哪些 production 机制被有意省略，不能直接外推

### 目的：参考它如何组织教程站点与用户手册

建议路线：

1. 先看站点首页与 `Timeline`
2. 再看 `docs/en` 或 `docs/zh` 的 session 手册目录
3. 然后看 `web/` 目录确认互动式站点如何承接手册
4. 必要时再看 `README` 的 Quick Start 与 Architecture 组织方式

重点想确认的问题：

- 互动教程和仓库手册如何形成双入口
- 多语言文档怎样与站点切换配合
- “概念解释 -> session 文档 -> 参考实现”这条学习链怎样组织

## 适合从 Learn Claude Code 借鉴什么

通常适合借鉴：

- 按机制渐进展开的教程路径设计
- 教程站点、README、手册、参考实现四层互相导流的结构
- 用简短 motto + session 编号去组织复杂 agent 机制
- 用 docs 先讲 mental model，再让读者下钻到代码
- 明确写出“教学范围边界”，避免读者把教程误认成生产真相

## 不要急着从 Learn Claude Code 借鉴什么

通常不要直接从它推导：

- Claude Code 官方私有实现细节
- 生产环境下完整的安全、权限、审批与治理设计
- 所有 agent 产品都应遵循的唯一架构
- 把教学仓库里的简化实现直接照搬到任何技术栈或业务场景

## 一句话判断

如果用户目的是：

- “我想教学式理解 Claude Code-like harness 机制”
- “我想找一套把教程、手册、参考实现串起来的 agent 学习入口”
- “我想对照 skills / subagents / tasks / teams / worktree isolation 这些机制”

那么 `Learn Claude Code` 应该进入优先参考源集合。
