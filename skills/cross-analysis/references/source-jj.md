# Jujutsu / jj

本文件是 `Jujutsu / jj` 的本地化搜索指南，不是版本控制百科词条。

它的目标是帮助 Agent 在遇到相关目的时，快速判断：

- 这个参考源值不值得纳入交叉分析
- 应该先从哪些入口开始检索
- 哪些主题适合参考它
- 哪些主题不应把它当作主参考

## 适合优先参考的目的

当用户目的涉及以下方向时，优先考虑 `Jujutsu / jj`：

- 分析 Git-compatible VCS 的对象模型、操作日志与版本管理语义
- 分析“working copy 也是 commit”“操作可撤销”“冲突是第一类对象”这类数据版本管理设计
- 分析内容存储层与更高层元数据如何解耦
- 分析 rewrite-heavy 工作流、自动 rebase、bookmark / revset 等机制如何被统一到一套 CLI 心智中

## 不要把它当成主参考的情况

以下场景里，`Jujutsu / jj` 通常不应作为唯一主参考：

- 需要实时多人协作、CRDT、在线同步协议这类系统的主参考
- 需要 Git forge UI、PR review 流程或托管平台产品设计的主参考
- 需要稳定 `1.0` 保证或覆盖所有 Git 工作流的成熟度前提
- 需要把 commit graph 直接等同为任何应用数据模型

说明：

- 这里写的是“参考价值边界”，不是产品优劣判断。
- `jj` 当前仍明确标注为 experimental，但 Git 兼容与核心工作流已经具备很强参考价值。
- 它更适合作为“版本语义 / 操作日志 / 数据边界”参考，而不是直接照搬命令表面。

## 优先检索入口

### 1. 官方产品入口

- GitHub 仓库：`https://github.com/jj-vcs/jj`
- 官网：`https://www.jj-vcs.dev`
- 安装：`https://docs.jj-vcs.dev/latest/install-and-setup`
- 教程：`https://docs.jj-vcs.dev/latest/tutorial`
- 路线图：`https://docs.jj-vcs.dev/latest/roadmap`

适合先回答：

- `jj` 的定位、成熟度与学习路径是什么
- 它为什么强调 Git compatibility 与不同存储后端
- 应该先看概念说明、教程还是技术文档

优先关注：

- Git-compatible
- experimental
- tutorial
- roadmap
- backend

### 2. 官方帮助文档

- Git Comparison：`https://docs.jj-vcs.dev/latest/git-comparison`
- Git Compatibility：`https://docs.jj-vcs.dev/latest/git-compatibility`
- Working Copy：`https://docs.jj-vcs.dev/latest/working-copy`
- Operation Log：`https://docs.jj-vcs.dev/latest/operation-log`
- Conflicts：`https://docs.jj-vcs.dev/latest/conflicts`
- Revsets：`https://docs.jj-vcs.dev/latest/revsets`
- Glossary：`https://docs.jj-vcs.dev/latest/glossary`
- FAQ：`https://docs.jj-vcs.dev/latest/FAQ`

适合先回答：

- `jj` 与 Git 在对象模型与日常心智上到底差在哪
- working-copy-as-a-commit、operation log、bookmark、revset 分别是什么
- 自动 rebase、冲突记录、colocated repo 等机制落在什么边界

如果目的是 `版本语义`、`undo`、`operation log`、`working copy`、`bookmark`、`revset`，优先检索这些关键词：

- operation log
- working copy
- bookmark
- revset
- conflicts
- colocated

### 3. 开发与实现入口

- 仓库根 README：`https://github.com/jj-vcs/jj/blob/main/README.md`
- 核心信条：`https://github.com/jj-vcs/jj/blob/main/docs/core_tenets.md`
- 设计文档目录：`https://github.com/jj-vcs/jj/tree/main/docs/design`
- 技术文档目录：`https://github.com/jj-vcs/jj/tree/main/docs/technical`
- CLI：`https://github.com/jj-vcs/jj/tree/main/cli`
- Library：`https://github.com/jj-vcs/jj/tree/main/lib`

适合先回答：

- `jj` 的内部对象模型和技术边界如何组织
- 哪些概念是 CLI UX，哪些是库层语义
- 操作日志、并发安全、Git backend 等设计在实现层怎么落地

如果目的是：

- 看概念与设计：先看 `docs/core_tenets.md`、`docs/design/`、`docs/technical/`
- 看命令与交互面：先看 `docs/cli-reference.md`、`cli/`
- 看底层模型：先看 `lib/` 与 `docs/technical/concurrency/`

### 4. GitHub 与生态入口

- Releases：`https://github.com/jj-vcs/jj/releases`
- Discussions：`https://github.com/jj-vcs/jj/discussions`
- Wiki / Media：`https://github.com/jj-vcs/jj/wiki/Media`
- GitHub 使用说明：`https://docs.jj-vcs.dev/latest/github`

适合先回答：

- 社区当前关注哪些工作流与痛点
- GitHub / Git remote 语境下的使用边界是什么
- 版本演进与媒体讨论指向了哪些核心卖点

### 5. 社区与交流入口

- Discord：`https://discord.gg/dkmfj3aGQN`
- IRC：`https://web.libera.chat/?channel=#jujutsu`

适合先回答：

- 某个工作流是否已有社区讨论
- 新概念或边界变化是否有开发者解释
- 若文档不够，下一跳可以去哪里补

## 面向常见目的的检索路线

### 目的：先理解 `jj` 的核心心智，而不是只看命令映射

建议路线：

1. 先看官网与 `README.md`
2. 再看 `tutorial`
3. 然后读 `git-comparison`、`working-copy`、`operation-log`
4. 最后用 `glossary` 补齐术语

重点想确认的问题：

- `jj` 最根本的用户心智是什么
- 它与 Git 的差异是命令差异，还是对象模型差异
- 哪些概念适合拿来做数据版本管理对照

### 目的：分析版本控制 / 数据版本管理 / undo 语义

建议路线：

1. 先看 `operation-log`
2. 再看 `working-copy` 与 `conflicts`
3. 然后看 `docs/technical/` 里的并发与实现说明
4. 必要时再回到 `docs/design/`

重点想确认的问题：

- 操作日志与内容版本各自记录什么
- 冲突为什么被提升为第一类对象
- 哪些能力来自对象模型设计，而不是单个命令技巧

### 目的：分析 Git 兼容与双栈共存边界

建议路线：

1. 先看 `git-compatibility`
2. 再看 `github` 与 `git-command-table`
3. 然后看 `README.md` 对 backend / metadata 的说明
4. 必要时下钻 `cli/` 与 `lib/`

重点想确认的问题：

- Git 兼容具体兼容到哪一层
- 哪些元数据在 Git 里，哪些不在 Git 里
- colocated `jj` / `git` workflow 如何影响实际协作

## 适合从 Jujutsu / jj 借鉴什么

通常适合借鉴：

- 用 operation log 把“我刚刚做了什么”变成可追踪、可撤销对象
- 把 working copy 也纳入统一版本对象模型
- 把冲突与自动 rebase 视作模型能力，而不是纯命令技巧
- 把内容存储层与更高层 metadata 分开建模

## 不要急着从 Jujutsu / jj 借鉴什么

通常不要直接从它推导：

- 应用级实时协作协议
- 任何非代码数据系统都应直接使用 commit graph 作为最终数据模型
- `jj` 当前实验性特性或未覆盖工作流的默认结论

## 一句话判断

如果用户目的是：

- “我想研究版本控制 / 数据版本管理的对象模型和操作日志”
- “我想对照 working-copy-as-a-commit、undo、自动 rebase、conflict object 这些语义”
- “我想分析 Git-compatible 存储层与更高层元数据如何拆边界”

那么 `Jujutsu / jj` 应该进入优先参考源集合。
