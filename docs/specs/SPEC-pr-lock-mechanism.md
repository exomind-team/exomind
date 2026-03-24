# SPEC: PR 锁机制 (PR Lock Mechanism)

**版本**: v1.0
**日期**: 2026-03-09
**状态**: MVP 实现中

---

## 1. 概述

### 1.1 目标

ExoMind PR 锁机制旨在解决多 Agent 协作时的 PR 并发冲突问题，确保：
- 同一时间只有一个 Agent 在处理一个 PR
- Agent 崩溃后可以自动恢复或释放锁
- 无需额外的守卫进程或后台服务

### 1.2 核心设计原则

| 原则 | 说明 |
|------|------|
| **无守卫进程** | 所有状态在查询时动态计算，不需要后台服务 |
| **无心跳机制** | 通过 PR 更新时间自动延期，无需定期续期 |
| **工作目录绑定** | 锁对应工作目录（worktree），不是 Agent 会话 |
| **强制验证** | Git hook 在 push 前验证锁状态（后续版本） |
| **懒惰释放** | 其他 Agent 查询时检测并清理过期锁 |

---

## 2. 锁的三种状态

### 2.1 未上锁 (Unlocked)

**特征：**
- PR 没有 🔒 locked 标签
- 本地工作目录没有 `.exomind/lock-state.json`
- 这是旧工作区或新工作区的初始状态

**行为：**
- Git push 直接放行，不经过 PR 锁系统验证
- Agent 可以自由工作，不受锁限制
- 如果需要协作，Agent 应该主动调用 `acquire` 获取锁

### 2.2 正上锁 (Locked)

**特征：**
- PR 有 🔒 locked 标签
- 远程有锁元数据 Comment
- 动态计算：`now < (pr_last_updated_at + lock_duration)`

**行为：**
- 持有者可以正常工作
- 其他 Agent 无法获取锁
- Git push 前验证锁状态（pre-push hook，后续版本）

### 2.3 锁过期 (Expired)

**特征：**
- PR 有 🔒 locked 标签（还未清理）
- 远程有锁元数据 Comment
- 动态计算：`now >= (pr_last_updated_at + lock_duration)`

**行为：**
- 其他 Agent 可以强制释放并获取新锁
- 原持有者 Git push 会被阻止（pre-push hook 验证失败，后续版本）
- 原持有者需要重新获取锁

### 2.4 状态转换图

```
未上锁 ──acquire──> 正上锁 ──timeout──> 锁过期 ──force-release──> 未上锁
           ↑                                           │
           └──────────────── release ─────────────────┘
```

---

## 3. 锁的生命周期

### 3.1 获取锁 (acquire)

**流程：**

1. Agent 在工作目录调用：`pr-lock acquire <pr-number> <timeout-minutes> <agent-id> --worktree-path=<path>`
2. 检查远程锁状态（动态计算是否过期）
3. 如果无锁或已过期：
   - 生成 `lock_id`: `lock-{timestamp}-{random}`
   - 添加 🔒 locked 标签
   - 创建锁 Comment（含元数据）
   - 保存到本地：`.exomind/lock-state.json`
4. 等待 2 秒，进行竞争检测（检查 timeline）
5. 如果检测到竞争，时间戳较晚的 Agent 主动放弃
6. 成功获取锁

**输入参数：**
- `pr_number`: PR 编号
- `timeout_minutes`: 锁的时长（默认 60 分钟）
- `agent_id`: Agent 标识（如 `fixer@team`）
- `worktree_path`: 工作目录路径（可选）
- `task_id`: 关联任务 ID（可选）
- `reason`: 锁定原因（可选）

**输出：**
```json
{
  "success": true,
  "lock": {
    "lock_id": "lock-1234567890-abc123",
    "pr_number": 419,
    "agent_id": "fixer@team",
    "worktree_path": "exomind-worktree-pr-419",
    "acquired_at": "2026-03-09T10:00:00Z",
    "lock_duration_minutes": 60,
    "task_id": "4",
    "reason": "修复 TypeScript 类型错误"
  }
}
```

### 3.2 查询锁状态 (check)

**流程：**

1. 任何 Agent 调用：`pr-lock check <pr-number>`
2. 读取远程锁元数据（从 PR Comment）
3. 读取 PR 最后更新时间（commits + comments）
4. 动态计算过期时间：`expires_at = pr_last_updated_at + lock_duration`
5. 判断：`now < expires_at` → 锁有效 / 锁过期
6. 如果本地有锁文件，更新本地状态

**输出：**
```json
{
  "lock_id": "lock-1234567890-abc123",
  "pr_number": 419,
  "agent_id": "fixer@team",
  "worktree_path": "exomind-worktree-pr-419",
  "acquired_at": "2026-03-09T10:00:00Z",
  "lock_duration_minutes": 60,
  "pr_last_updated_at": "2026-03-09T10:50:00Z",
  "expires_at": "2026-03-09T11:50:00Z",
  "is_expired": false,
  "remaining_minutes": 35
}
```

### 3.3 释放锁 (release)

**流程：**

1. Agent 完成工作后调用：`pr-lock release <pr-number> <agent-id>`
2. 验证 `lock_id` 匹配（读取本地锁文件）
3. 移除 🔒 locked 标签
4. 创建释放 Comment
5. 删除本地 `.exomind/lock-state.json`

**输出：**
```json
{
  "success": true
}
```

### 3.4 强制释放过期锁 (force-release)

**流程：**

1. 其他 Agent 检测到锁过期时调用：`pr-lock force-release <pr-number>`
2. 移除 🔒 locked 标签
3. 创建超时释放 Comment
4. 不删除本地锁文件（因为是其他 Agent 调用）

**使用场景：**
- Agent B 尝试获取锁时，发现 Agent A 的锁已过期
- Agent B 先调用 `force-release` 清理过期锁
- 然后 Agent B 调用 `acquire` 获取新锁

### 3.5 Agent 重启恢复

**流程：**

1. Agent 重启 → 检查本地锁文件 `.exomind/lock-state.json`
2. 读取 `lock_id` 和 `pr_number`
3. 调用：`pr-lock check <pr-number>`
4. 根据结果决定：
   - **情况 1**：锁有效且 `lock_id` 匹配 → 恢复工作
   - **情况 2**：锁已过期 → 尝试重新获取锁
   - **情况 3**：`lock_id` 不匹配（被抢占）→ 尝试重新获取锁
   - **情况 4**：PR 已合并 → 提示用户并停止

---

## 4. 过期时间动态计算

### 4.1 核心公式

```
expires_at = pr_last_updated_at + lock_duration
```

### 4.2 PR 最后更新时间

**定义：** PR 最后一次有意义的活动时间

**包含的事件：**
- ✅ 代码提交（git push）
- ✅ PR 评论（comments）

**不包含的事件：**
- ❌ 标签变更
- ❌ PR 描述修改
- ❌ Reviewer 变更
- ❌ CI 状态变化

**获取方式：**
```bash
# 获取最后一次 commit 时间
gh api repos/{owner}/{repo}/pulls/{pr_number}/commits \
  --jq '.[-1].commit.committer.date'

# 获取最后一次评论时间
gh api repos/{owner}/{repo}/issues/{pr_number}/comments \
  --jq '.[-1].created_at'

# 取两者中较晚的时间
pr_last_updated_at = max(last_commit_time, last_comment_time)
```

### 4.3 计算示例

```
时间线：
10:00 - Agent 获取锁（60 分钟）
        pr_last_updated_at = 10:00
        expires_at = 10:00 + 60min = 11:00

10:30 - Agent 提交代码
        pr_last_updated_at = 10:30（自动更新）
        expires_at = 10:30 + 60min = 11:30（自动延期）

10:50 - Agent 发评论
        pr_last_updated_at = 10:50
        expires_at = 10:50 + 60min = 11:50

11:50 - 无任何活动
        锁过期 ⏰
```

**关键点：**
- 无需守卫进程，所有 Agent 查询时动态计算
- PR 有活动（提交/评论）→ 锁自动延期
- 长时间无活动 → 锁自然过期

---

## 5. 数据结构

### 5.1 本地锁文件

**文件路径：** `.exomind/lock-state.json`

**注意：** 此文件不进 Git，需添加到 `.gitignore`

**数据结构：**
```json
{
  "lock_id": "lock-1234567890-abc123",
  "pr_number": 419,
  "acquired_at": "2026-03-09T10:00:00Z",
  "lock_duration_minutes": 60,
  "pr_last_updated_at": "2026-03-09T10:50:00Z",
  "expires_at": "2026-03-09T11:50:00Z"
}
```

**更新时机：**
- 获取锁时：写入初始数据
- 查询锁时：更新 `pr_last_updated_at` 和 `expires_at`
- 释放锁时：删除文件

### 5.2 远程锁元数据

**存储位置：** PR Comment（HTML 注释）

**格式：**
```markdown
<!-- LOCK_METADATA
{
  "lock_id": "lock-1234567890-abc123",
  "worktree_path": "exomind-worktree-pr-419",
  "agent_id": "fixer@team",
  "acquired_at": "2026-03-09T10:00:00Z",
  "lock_duration_minutes": 60,
  "task_id": "4",
  "reason": "修复 TypeScript 类型错误"
}
-->

🔒 **PR 已被锁定**

- 持有者：`fixer@team`
- 工作目录：`exomind-worktree-pr-419`
- 锁 ID：`lock-1234567890-abc123`
- 获取时间：2026-03-09T10:00:00Z
- 锁时长：60 分钟
- 任务：#4
- 原因：修复 TypeScript 类型错误

**过期时间动态计算：**
过期时间 = PR 最后更新时间 + 60 分钟
每次提交或评论后，锁自动延期。
```

**注意：** 远程元数据中**不存储** `expires_at`，因为它是动态计算的。

---

## 6. CLI 命令设计

### 6.1 获取锁

```bash
bun Scripts/lib/pr-lock.ts acquire <pr-number> <timeout-minutes> <agent-id> \
  [--worktree-path=<path>] \
  [--task-id=<id>] \
  [--reason="<reason>"]
```

**示例：**
```bash
bun Scripts/lib/pr-lock.ts acquire 419 60 fixer@team \
  --worktree-path="exomind-worktree-pr-419" \
  --task-id=4 \
  --reason="修复 TypeScript 类型错误"
```

### 6.2 查询锁状态

```bash
bun Scripts/lib/pr-lock.ts check <pr-number>
```

**输出：** JSON 格式的锁状态（包含动态计算的过期时间）

### 6.3 释放锁

```bash
bun Scripts/lib/pr-lock.ts release <pr-number> <agent-id>
```

### 6.4 强制释放过期锁

```bash
bun Scripts/lib/pr-lock.ts force-release <pr-number>
```

**注意：** 只能释放已过期的锁，否则返回错误。

---

## 7. Git Hook 设计（后续版本）

### 7.1 pre-push Hook

**文件路径：** `.git/hooks/pre-push`

**逻辑：**
```bash
#!/bin/bash
# ExoMind PR Lock 验证

LOCK_FILE=".exomind/lock-state.json"

# 检查是否有锁文件
if [ ! -f "$LOCK_FILE" ]; then
  # 旧工作区，未上锁，直接放行
  exit 0
fi

# 读取 PR 号
PR_NUMBER=$(jq -r '.pr_number' "$LOCK_FILE")

# 验证锁状态
bun Scripts/lib/pr-lock.ts check "$PR_NUMBER"

if [ $? -ne 0 ]; then
  echo "❌ 锁验证失败：锁已过期或被其他 Agent 抢占"
  echo "请运行：pr-lock check $PR_NUMBER 查看详情"
  exit 1
fi

exit 0
```

**行为：**
- 如果本地没有锁文件 → 直接放行（未上锁状态）
- 如果有锁文件 → 验证锁状态
- 锁有效 → 允许 push
- 锁无效 → 阻止 push，提示错误

---

## 8. MVP 范围

### 8.1 包含功能

- ✅ 核心的 `acquire` / `release` / `check` 方法
- ✅ 动态过期时间计算逻辑
- ✅ 本地锁文件管理
- ✅ CLI 命令
- ✅ 基本测试

### 8.2 不包含功能（后续版本）

- ❌ Git pre-push hook
- ❌ 心跳机制（设计中已废弃）
- ❌ 一对多 PR 支持（一个工作目录处理多个 PR）
- ❌ 文件级锁（细粒度锁）

---

## 9. 测试场景

### 9.1 核心测试

1. **互斥性测试**：Agent A 获取锁 → Agent B 尝试获取 → 失败
2. **超时释放测试**：Agent A 获取锁 → 等待过期 → Agent B 获取成功
3. **竞争检测测试**：Agent A 和 B 同时获取 → 只有一个成功
4. **锁续期测试**：Agent 提交代码 → 锁自动延期
5. **所有权检查测试**：Agent A 获取锁 → Agent B 尝试释放 → 失败

### 9.2 动态过期时间测试

1. **提交代码延期**：获取锁 → 提交代码 → 验证过期时间更新
2. **发评论延期**：获取锁 → 发评论 → 验证过期时间更新
3. **长时间无活动**：获取锁 → 等待超时 → 验证锁过期

### 9.3 本地锁文件测试

1. **保存锁状态**：获取锁 → 验证本地文件存在
2. **更新锁状态**：查询锁 → 验证本地文件更新
3. **删除锁状态**：释放锁 → 验证本地文件删除

---

## 10. 实现清单

- [ ] 实现动态过期时间计算逻辑
- [ ] 实现本地锁文件管理
- [ ] 重构 `acquire` 方法（支持工作目录绑定）
- [ ] 重构 `check` 方法（动态计算过期时间）
- [ ] 重构 `release` 方法（清理本地状态）
- [ ] 更新 CLI 命令（支持新参数）
- [ ] 更新测试脚本（验证新逻辑）
- [ ] 更新 `.gitignore`（排除本地锁文件）

---

**文档版本**: v1.0
**最后更新**: 2026-03-09
