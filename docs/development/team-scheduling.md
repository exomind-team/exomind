# 多 Agent 团队调度经验

> Claude Code 团队模式下的 Agent 协作实践经验

## 概述

本文档记录了使用 Claude Code 的 `TeamCreate` 和 `Task` 工具进行多 Agent 协作开发的实践经验，包括团队结构设计、teammate 配置、工具权限管理等。

---

## 团队结构模式

使用 `TeamCreate` 创建持久团队，配合专职 teammate 分工：

```
team-lead（Claude Code 主会话）
├── dev-server   — 管理开发服务器生命周期（Vite + PouchDB）
├── coder        — 监督 Codex 编码任务（启动/监控/验证/汇报）
└── （按需扩展）
```

**核心原则**：team-lead 只做任务分配与结果汇总，不自己执行耗时任务。

---

## dev-server teammate

### 职责

后台启动并保活开发服务器，响应重启/状态查询指令。

### Termux 注意事项

- `/tmp` 无写权限，日志必须写到 `$TMPDIR`（如 `$TMPDIR/exomind-vite-5173.log`）
- 后台进程用 `run_in_background: true` 启动，避免阻塞会话

### 启动命令

```bash
# Vite 开发服务器
npx vite --host 0.0.0.0 --port 5173 > $TMPDIR/exomind-vite-5173.log 2>&1

# PouchDB Sync 服务器（已废弃，no-sync-server 架构）
# EXOMIND_POUCHDB_HOST=0.0.0.0 EXOMIND_POUCHDB_PORT=6984 node server/pouchdb-server.js > $TMPDIR/exomind-pouchdb-6984.log 2>&1
```

### 验证可用性

```bash
curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 3
```

---

## coder teammate（Codex 监督员）

### 职责

接收编码任务 → 启动 Codex → 监控进度 → 验证结果 → 汇报 team-lead。

### 核心原则

**coder 是监督员，不是执行者**：
- 所有编码任务 **必须通过 `mcp__ai-cli-mcp__run` 启动 Codex** 完成，coder 自己不用 Edit/Write 直接写代码
- 仅在 Codex 输出需要极小修正（1-2 行 typo）时才允许亲手微调
- git 操作、依赖安装等非编码的 shell 命令可以直接执行

### 标准工作流

1. 用 `mcp__ai-cli-mcp__run` 启动 Codex（model: `sonnet`）
2. 用 `mcp__ai-cli-mcp__wait` 阻塞等待（timeout 300s）
3. 超时则用 `get_result block=false` 检查是否仍在运行
4. 完成后执行验证：`npx tsc --noEmit` + `npx vitest run`
5. 向 team-lead 汇报：输出摘要 + 编译结果 + 测试通过数

### Termux 并发上限

同时运行 Codex 不超过 3 个，超出会因内存不足全部崩溃。

---

## Codex 任务 Prompt 写作规范

### 必备要素

| 要素 | 说明 |
|------|------|
| **工作目录** | 明确 `workFolder` 绝对路径 |
| **当前分支** | 告知分支名，避免在错误分支提交 |
| **背景上下文** | 已完成的接口/类型定义，避免 Codex 猜测 |
| **文件级指令** | 明确「完全替换」vs「末尾追加」vs「局部修改」 |
| **路径别名** | 注明 `@/lib/...` 映射到 `src/lib/...` |
| **验证步骤** | 要求 Codex 自己运行 tsc + vitest，不通过不提交 |
| **忽略范围** | 明确哪些文件的错误可以忽略（如旧 UI 文件） |
| **完成报告** | 要求输出：编译结果、测试数、具体报错 |

### 反模式（避免）

- ❌ 一次让 Codex 改超过 6 个文件（容易超时、丢失上下文）
- ❌ 不给验证步骤（Codex 可能提交有编译错误的代码）
- ❌ 20 个并行 Codex（Termux 内存不足，全部崩溃）

---

## Teammate MCP 工具权限

### 问题

Teammate（通过 `Task(team_name=...)` spawn 的子 agent）**默认不继承主会话的 MCP 工具**。MCP server 进程绑定在主会话，teammate 在独立 tmux pane 中运行，需要单独配置。

### 解决方案：全局配置 MCP server

在 `~/.claude/settings.json` 的 `mcpServers` 字段添加 MCP server 配置，所有 Claude Code 会话（包括 teammate）都会自动加载：

```json
{
  "mcpServers": {
    "ai-cli-mcp": {
      "command": "ai-cli-mcp",
      "args": []
    }
  }
}
```

**前置条件**：`npm install -g ai-cli-mcp` 全局安装。

### 配置层级优先级

| 位置 | 作用域 | teammate 可用 |
|------|--------|--------------|
| `~/.claude/settings.json` → `mcpServers` | 全局 | ✅ 所有会话 |
| `.mcp.json`（项目根目录） | 项目级 | ✅ 同项目下的 teammate |
| 主会话运行时注入（如 `npm exec`） | 仅主会话 | ❌ teammate 不继承 |

### 经验教训

如果 coder teammate 需要调度 Codex（通过 `mcp__ai-cli-mcp__run`）来节省 token，必须确保 ai-cli-mcp 在全局或项目级 MCP 配置中声明。仅在主会话中可用的 MCP 工具不会传递给 teammate。

---

## 团队通信规范

### 基本规则

- teammate 用 `SendMessage type=message` 向 team-lead 汇报，**不能只在文本中说话**
- idle 通知（`{"type":"idle_notification",...}`）是正常现象，无需响应
- team-lead 用 `SendMessage type=shutdown_request` 关闭 teammate
- 调试产物（`/tmp/*.log`）不提交 git

### 消息类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `message` | 单向汇报 | coder → team-lead：任务完成 |
| `broadcast` | 全员通知 | team-lead → 所有人：紧急停止 |
| `shutdown_request` | 请求关闭 | team-lead → coder：任务结束 |

---

## tmux 窗口调度机制

### 架构

Claude Code 的 `TeamCreate` + `Task(team_name=...)` 会自动基于 tmux 管理 teammate 进程，无需手动配置。

```
tmux session
├── pane %0  →  team-lead（主会话）
├── pane %1  →  dev-server
├── pane %2  →  coder
└── pane %N  →  （按需扩展）
```

### 自动行为

| 特性 | 说明 |
|------|------|
| **pane 自动创建** | 每个 teammate spawn 时自动分配独立 tmux pane |
| **pane 标题动态更新** | 标题跟随 agent 当前工作内容自动变化（如"编译修复与文档变更"） |
| **状态指示符** | `⠂` = 活跃/思考中，`✳` = idle/就绪 |
| **窗口标题跟随** | tmux `automatic-rename on` 让窗口标题显示活跃 pane 内容 |

### 持久化配置

- **团队配置**：`~/.claude/teams/{team-name}/config.json`
  - 包含每个 member 的 `tmuxPaneId`、`name`、`prompt`、`backendType: "tmux"`
- **消息邮箱**：`~/.claude/teams/{team-name}/inboxes/`
  - 文件系统邮箱，teammate 间异步通信

### 复现步骤

1. `TeamCreate` 创建团队 → 自动创建 team 配置和任务目录
2. `Task(team_name=..., name="dev-server")` → 自动创建 tmux pane，标题为 Task 的 description
3. Claude Code 内部通过 `tmux select-pane -T "标题"` 动态更新 pane 标题
4. teammate idle/active 状态自动切换指示符

**注意**：这是 Claude Code `backendType: "tmux"` 的内置能力，不需要用户编写 tmux 脚本。

---

## 相关文档

- [Termux 环境开发指南](./termux-environment.md)
- [团队协作规范](./team-collaboration.md)

---

*最后更新：2026-03-09*
