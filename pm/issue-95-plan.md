# Issue #95 时间块反馈报告显示 - 实施计划

关联 Issue: https://github.com/exomind-team/exomind/issues/95

## 目标（对齐 Issue 正文“落脚功能点”）

在“结束时间块 + 填写/跳过反馈”后，**反馈那条消息**需要被扩充，至少包含：
1. 输入反馈所用时间（`feedbackDuration`）
2. 暂停总时长（`pausedDuration`，不依赖 #76 的事件落库，先用 active_block 累计值）
3. 实际工作时间（`workDuration = actionDuration - pausedDuration`）
4. 时间块总时长（`totalDuration = startTime -> 提交反馈`，包含反馈输入过程）

同时尽可能提供关键时间点：
- 行动结束时间（点击“结束”的时刻）
- 反馈提交时间（提交/跳过反馈的时刻）

输出格式优先用 Markdown 文本模板；但由于 #93（markdown 渲染）阻塞，本次先保证：
- 内容按 Markdown 结构生成（列表/换行）
- UI 先用 `whitespace-pre-wrap` 保证换行可读（不做完整 markdown 解析）

## 范围与非目标

- ✅ 本分支交付：计算口径 + 数据落库（metadata）+ 反馈消息扩充 + 基础可读展示
- ❌ 不做：完整 Markdown 解析渲染（#93）
- ❌ 不做：暂停/恢复作为独立事件的可追溯链路（#76）

## 关键设计（数据与口径）

### 新增 active_block 字段（存储在 `ACTIVE_BLOCK_KEY`）

在 `ActiveBlockData` 扩展：
- `actionEndedAt?: number`：点击“结束”时刻（行动结束）
- `feedbackStartedAt?: number`：反馈弹窗打开时刻（默认与 `actionEndedAt` 一致）
- `pauseAccumulatedMs?: number`：累计暂停时长（毫秒）

兼容旧数据：缺字段时默认 `pauseAccumulatedMs = 0`；缺 `actionEndedAt/feedbackStartedAt` 时按 `submittedAt` 兜底。

### 暂停累计口径（不依赖 #76）

- `pauseBlock()`：设置 `pausedAt = now`
- `resumeBlock()`：`pauseAccumulatedMs += now - pausedAt`，并清空 `pausedAt`
- 若在暂停态触发结束：在计算时把“最后一次暂停片段”补齐到 `actionEndedAt`（或兜底 `submittedAt`）

### 时长计算口径（在 `endBlock()` 统一生成）

设：
- `startTime`
- `actionEndedAt`（若无，用 `submittedAt`）
- `feedbackStartedAt`（若无，用 `actionEndedAt`）
- `submittedAt = Date.now()`
- `pausedDurationMs = pauseAccumulatedMs (+ 当前暂停片段补齐)`

则：
- `actionDurationMs = actionEndedAt - startTime`
- `feedbackDurationMs = submittedAt - feedbackStartedAt`
- `totalDurationMs = submittedAt - startTime`
- `workDurationMs = max(0, actionDurationMs - pausedDurationMs)`

### 事件写入策略（报告挂在反馈消息上）

`block_feedback` 事件始终写入（即使用户跳过反馈），并携带：
- `content`: 反馈文本 + 4 个指标（Markdown 文本模板）
- `metadata`: 结构化毫秒字段，便于后续统计

`block_end` 事件仍保留（用于时间点记录）；但它的语义不强依赖展示，本次重点是反馈报告。

## 改动点（逐文件）

1) `src/lib/types/event.ts`
- 扩展 `ActiveBlockData` 字段定义

2) `src/lib/services/timeblock.service.ts`
- 新增 `markEnding()`：点击“结束”时落库 `actionEndedAt/feedbackStartedAt`（若已存在则幂等）
- `pauseBlock/resumeBlock` 维护 `pauseAccumulatedMs`
- `endBlock()`：计算 4 个时长、生成 `block_feedback`（无反馈也写），并写 `metadata`

3) `src/components/TimeBlockWidget.tsx`
- 点击“结束”时先 `markEnding()`，再打开反馈 Dialog
- 倒计时归零自动弹窗时也触发 `markEnding()`

4) `src/components/Chat/ChatPage.tsx`
- `event.content` 展示增加 `whitespace-pre-wrap`，保证换行/列表可读

5) 测试
- `tests/unit/services/timeblock.service.test.ts`：覆盖
  - 无反馈也会写 `block_feedback`（内容包含报告）
  - 暂停累计 + 结束时暂停片段补齐
  - `metadata` 字段齐全且计算口径正确
- `tests/unit/components/TimeBlockWidget.resume.test.tsx`：更新 mock（新增 `markEnding`）并补一条“点击结束会调用 markEnding”

## 验收标准（可执行检查表）

- [ ] 点击“结束”后，行动时长停止增长（报告里 `实际工作/行动时长` 不再随反馈输入变长）
- [ ] 反馈输入期间：`反馈用时` 与 `总时长` 增长；提交后固定
- [ ] 反馈消息包含 4 个指标：反馈用时/暂停时长/实际工作/总时长
- [ ] 暂停多次后：暂停时长累计正确；实际工作 = 行动 - 暂停
- [ ] 跳过反馈：仍生成反馈消息报告（反馈文本显示“未填写”或同等占位）
- [ ] 刷新后历史记录不丢失（报告来自事件存储内容+metadata）

## Issue 评论草稿（用于开工前对齐）

我将按 Issue #95 的“落脚功能点”实现：在 `block_feedback` 消息内输出报告（Markdown 文本模板），并在 `metadata` 写结构化毫秒字段（feedback/paused/work/total）。本次不做完整 Markdown 渲染（#93），UI 先用 `whitespace-pre-wrap` 保证换行可读；暂停总时长不依赖 #76 的事件落库，先在 `active_block` 里累计。

验收：反馈消息能看到 4 个指标；总时长包含反馈输入过程；实际工作 = 行动 - 暂停；跳过反馈仍生成报告；多次暂停累计正确。

