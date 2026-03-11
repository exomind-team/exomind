# 状态文件与工作树（Worktree）

## 读取时机

- 本文档属于恢复与本地验证辅助协议
- 只有在需要解释本地状态文件、恢复失败上下文或创建/复用 worktree 做验证时，才必须读取并遵循本文
- discovery / review 的普通冷启动不再要求预先加载本文

## 说明

- 本文件描述的是本地辅助状态，不是第一真相源
- `state/queue/backoff/cursor` 只能用于恢复辅助、焦点提示、调度建议
- worktree 只帮助验证，不提供真相裁决

## 目录结构

建议在 `./temp/` 下使用如下状态布局：

```text
temp/
  pr-monitor/
    state.json
    queue.json
    backoff.json
    cursor.json
    drafts/
  worktrees/
    pr-<number>/
```

## 状态结构

### `state.json`

- 当前循环状态
- 当前阶段（`phase`）
- 下一步动作（`nextAction`）
- 上一轮失败或成功前的阶段（`lastPhase`）
- 当前选中的 PR 编号
- 最近一次成功轮次的时间戳
- 连续失败次数

其中：

- `selectedPrNumber` 只是当前焦点 hint，不是独立真相源
- `state.json` 不再保存任何主评论身份信息
- 当前主评论必须在每次 review action 前通过 GitHub 远端重新识别

### `queue.json`

- 有序的 `actionable_prs`
- 当前 `pending_queue`
- 本轮 discovery 的 `warnings`（例如 thread reply 信号退化）

### `backoff.json`

- 当前 sleep 秒数
- 连续无变化轮次
- 仅用于调度建议；不能决定是否跳过下一轮 GitHub discovery

### `cursor.json`

- 每个 PR 上最后处理的 `[Codex Reviewer]` 评论时间戳
- 每个 PR 上最后看到的 commit SHA
- 每个 PR 上最后处理的 comment、review 或 review thread reply id（仅回复评论）

## 游标规则

- 仅在成功轮次结束后更新游标。
- 若评论发布失败，不要推进游标。
- 必须保留足够的游标数据，以避免重启后重复发审核评论。
- 若 review 在评论发布后、approve/request-changes 前失败，下一轮仍应先按 GitHub 远端重新识别当前主评论，而不是依赖本地 comment id。

## 退避状态

- 初始值为 180 秒
- 连续无变化轮次时翻倍
- 上限为 1800 秒
- 一旦发现待处理 PR，立即重置为 180 秒
- 即使存在 backoff，下一轮统一入口仍要先经 router/discovery 重查 GitHub 当前事实

## 工作树（Worktree）生命周期

### 创建

只有在 review-loop 规则明确需要时，才创建 `./temp/worktrees/pr-{number}/`。

### 复用

满足以下条件时复用已有 PR worktree：

- 它仍指向相同的 PR head 上下文
- 它仍可正常读取和使用

### 保留

若 PR 仍处于 open 状态，且后续可能继续做本地验证，则保留该 worktree。

### 删除

只有在 PR 已合并，或该 worktree 明确过时无用时，才删除它。

## 清理规则

在一次审阅轮次结束时：

- 清理 `./temp/pr-monitor/drafts/` 下不再需要的临时草稿
- 保留队列与游标状态
- 保留相关 PR worktree

在一次“当前无目标”轮次结束时：

- 检查已合并 PR 的 worktree 并删除
- 在进入 sleep 前持久化 backoff 状态

## 重启恢复

重启后应：

1. 先运行 router
2. 读取 `state.json`、`queue.json`、`backoff.json` 与 `cursor.json`
3. 校验 `selected_pr` 仍然处于 open 状态
4. 校验 `pending_queue` 中的 PR 仍然处于 open 状态
5. 若上一轮是 `NO_TARGET`，也必须重新进入 discovery，不能仅凭本地 backoff/state 直接等待
6. 基于当前 GitHub 事实恢复，而不是盲目依赖本地旧状态
